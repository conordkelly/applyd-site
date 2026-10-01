// PATCH /api/worker/apply-email
//   { userId, applyEmail }
// Reassign a user's @everydaymail.ca apply address (ops / test).
// Auth: X-Worker-Key via /api/worker/_middleware.js

import {
  APPLY_EMAIL_DOMAIN,
  ensureApplyEmailTables,
  syncCanonicalApplyEmail,
} from "../_apply_email.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const userId = String((body && body.userId) || "").trim();
  const applyEmail = String((body && body.applyEmail) || "")
    .trim()
    .toLowerCase();

  if (!userId) return json({ error: "userId is required" }, 400);
  if (!applyEmail || !applyEmail.endsWith("@" + APPLY_EMAIL_DOMAIN)) {
    return json(
      {
        error:
          "applyEmail must be a full address on @" + APPLY_EMAIL_DOMAIN,
      },
      400
    );
  }

  await ensureApplyEmailTables(env.DB);

  const user = await env.DB.prepare(
    "SELECT id, email FROM users WHERE id = ?"
  )
    .bind(userId)
    .first();
  if (!user) return json({ error: "User not found" }, 404);

  const taken = await env.DB.prepare(
    "SELECT email, user_id FROM apply_email_addresses WHERE email = ?"
  )
    .bind(applyEmail)
    .first();
  if (taken && taken.user_id !== userId) {
    return json(
      { error: "applyEmail already assigned to another user", applyEmail },
      409
    );
  }

  const prev = await env.DB.prepare(
    "SELECT email FROM apply_email_addresses WHERE user_id = ?"
  )
    .bind(userId)
    .first();
  const previousEmail = (prev && prev.email) || null;

  await env.DB.prepare(
    "DELETE FROM apply_email_addresses WHERE user_id = ?"
  )
    .bind(userId)
    .run();

  await env.DB.prepare(
    `INSERT INTO apply_email_addresses (email, user_id) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id`
  )
    .bind(applyEmail, userId)
    .run();

  const row = await env.DB.prepare(
    "SELECT data FROM profiles WHERE user_id = ?"
  )
    .bind(userId)
    .first();

  let profile = {};
  if (row && row.data) {
    try {
      profile = JSON.parse(row.data);
    } catch {
      profile = {};
    }
  }
  profile.apply_email = applyEmail;
  profile.apply_email_assigned_at = new Date().toISOString();
  if (profile.apply_email_forward_to_personal === undefined) {
    profile.apply_email_forward_to_personal = true;
  }
  syncCanonicalApplyEmail(profile);
  if (profile.canonical && profile.canonical.contact) {
    profile.canonical.contact.email = applyEmail;
  }

  await env.DB.prepare(
    `INSERT INTO profiles (user_id, data, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       data = excluded.data,
       updated_at = excluded.updated_at`
  )
    .bind(userId, JSON.stringify(profile))
    .run();

  return json({
    ok: true,
    userId,
    previousEmail,
    applyEmail,
  });
}
