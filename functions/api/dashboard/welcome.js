// POST /api/dashboard/welcome
// Sends the one-time welcome email if it hasn't been sent yet.
// Idempotent: safe to call on every dashboard load.

import { sendEmail, buildWelcomeEmail } from "../_email.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { env, data } = context;
  const userId = data.userId;
  const email = String(data.email || "").trim();

  if (!email) {
    return json({ ok: true, skipped: true, reason: "no_email" });
  }

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

  const firstName =
    (profile.first_name && String(profile.first_name).trim()) ||
    (profile.canonical &&
      profile.canonical.identity &&
      profile.canonical.identity.first_name) ||
    "";

  const content = buildWelcomeEmail({ firstName });
  const result = await sendEmail(env, {
    to: email,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  if (result.skipped) {
    // Don't stamp welcomeEmailSent when we couldn't send (no API key yet).
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

  return json({ ok: true, sent: true, id: result.id || null });
}
