// GET  /api/dashboard/mail — list current user's apply messages
// GET  /api/dashboard/mail?id= — one message
// PATCH /api/dashboard/mail — update forward setting { forwardToPersonal: bool }

import {
  ensureApplyEmail,
  ensureApplyEmailTables,
} from "../_apply_email.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadProfile(env, userId) {
  const row = await env.DB.prepare(
    "SELECT data FROM profiles WHERE user_id = ?"
  )
    .bind(userId)
    .first();
  if (!row || !row.data) return {};
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

async function saveProfile(env, userId, profile) {
  await env.DB.prepare(
    "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  )
    .bind(userId, JSON.stringify(profile))
    .run();
}

export async function onRequestGet(context) {
  const { request, env, data } = context;
  await ensureApplyEmailTables(env.DB);

  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim();

  if (id) {
    const row = await env.DB.prepare(
      `SELECT id, to_address, from_address, subject, body_text, body_html,
              received_at, forwarded_at, forward_status
       FROM apply_messages WHERE id = ? AND user_id = ?`
    )
      .bind(id, data.userId)
      .first();
    if (!row) return json({ error: "Not found" }, 404);
    return json({ message: row });
  }

  const { results } = await env.DB.prepare(
    `SELECT id, to_address, from_address, subject, received_at, forwarded_at, forward_status
     FROM apply_messages WHERE user_id = ?
     ORDER BY received_at DESC LIMIT 100`
  )
    .bind(data.userId)
    .all();

  let profile = await loadProfile(env, data.userId);
  const ensured = await ensureApplyEmail(env, {
    userId: data.userId,
    profile,
    firstName: profile.first_name,
    lastName: profile.last_name,
  });
  profile = ensured.profile;
  if (ensured.created) await saveProfile(env, data.userId, profile);

  return json({
    applyEmail: profile.apply_email || null,
    forwardToPersonal: profile.apply_email_forward_to_personal !== false,
    messages: results || [],
  });
}

export async function onRequestPatch(context) {
  const { request, env, data } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  let profile = await loadProfile(env, data.userId);
  const ensured = await ensureApplyEmail(env, {
    userId: data.userId,
    profile,
    firstName: profile.first_name,
    lastName: profile.last_name,
  });
  profile = ensured.profile;

  if (typeof body.forwardToPersonal === "boolean") {
    profile.apply_email_forward_to_personal = body.forwardToPersonal;
  }

  await saveProfile(env, data.userId, profile);
  return json({
    ok: true,
    applyEmail: profile.apply_email || null,
    forwardToPersonal: profile.apply_email_forward_to_personal !== false,
  });
}
