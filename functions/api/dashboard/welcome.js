import { sendEmail, buildWelcomeEmail } from "../_email.js";
import { ensureApplyEmail } from "../_apply_email.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const userId = data.userId;
  const email = String(data.email || "").trim();

  if (!email) {
    return json({ ok: true, skipped: true, reason: "no_email" });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const clerkFirst = String((body && body.firstName) || "").trim();
  const clerkLast = String((body && body.lastName) || "").trim();

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

  if (!profile.onboarding || typeof profile.onboarding !== "object") {
    profile.onboarding = {};
  }
  if (profile.onboarding.welcomeEmailSent) {
    return json({ ok: true, alreadySent: true });
  }

  // Prefer Clerk signup names; fall back to My Info if already filled.
  if (clerkFirst && !String(profile.first_name || "").trim()) {
    profile.first_name = clerkFirst;
  }
  if (clerkLast && !String(profile.last_name || "").trim()) {
    profile.last_name = clerkLast;
  }
  if (
    profile.canonical &&
    typeof profile.canonical === "object" &&
    profile.canonical.identity &&
    typeof profile.canonical.identity === "object"
  ) {
    if (clerkFirst && !String(profile.canonical.identity.first_name || "").trim()) {
      profile.canonical.identity.first_name = clerkFirst;
    }
    if (clerkLast && !String(profile.canonical.identity.last_name || "").trim()) {
      profile.canonical.identity.last_name = clerkLast;
    }
  }

  const ensured = await ensureApplyEmail(env, {
    userId,
    profile,
    firstName: profile.first_name || clerkFirst,
    lastName: profile.last_name || clerkLast,
  });
  profile = ensured.profile;

  const firstName =
    (profile.first_name && String(profile.first_name).trim()) ||
    clerkFirst ||
    (profile.canonical &&
      profile.canonical.identity &&
      profile.canonical.identity.first_name) ||
    "";

  const content = buildWelcomeEmail({
    firstName,
    applyEmail: profile.apply_email || "",
  });
  const result = await sendEmail(env, {
    to: email,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  if (result.skipped) {
    await env.DB.prepare(
      "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
    )
      .bind(userId, JSON.stringify(profile))
      .run();
    return json({ ok: true, skipped: true, reason: result.reason || "skipped" });
  }

  if (!result.ok) {
    return json(
      { ok: false, error: result.error || "send_failed" },
      502
    );
  }

  profile.onboarding.welcomeEmailSent = true;
  profile.onboarding.welcomeEmailSentAt = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  )
    .bind(userId, JSON.stringify(profile))
    .run();

  return json({
    ok: true,
    sent: true,
    id: result.id || null,
    applyEmail: profile.apply_email || null,
  });
}
