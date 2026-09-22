import { ensureAtsCredentials } from "../_ats_passwords.js";
import { ensureApplyEmail, syncCanonicalApplyEmail } from "../_apply_email.js";

export async function onRequestGet(context) {
  const { env, data } = context;

  const row = await env.DB.prepare(
    "SELECT data FROM profiles WHERE user_id = ?"
  )
    .bind(data.userId)
    .first();

  let profile = {};
  if (row && row.data) {
    try {
      profile = JSON.parse(row.data);
    } catch {
      profile = {};
    }
  }

  const ensured = await ensureApplyEmail(env, {
    userId: data.userId,
    profile,
    firstName: profile.first_name,
    lastName: profile.last_name,
  });
  profile = ensured.profile;
  if (ensured.created) {
    await env.DB.prepare(
      "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
    )
      .bind(data.userId, JSON.stringify(profile))
      .run();
  }

  return json({ profile });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const profile =
    body && typeof body.profile === "object" && body.profile !== null
      ? body.profile
      : {};

  if (!profile.canonical || typeof profile.canonical !== "object") {
    profile.canonical = {};
  }
  profile.canonical.user_id = data.userId;
  if (!profile.canonical.contact || typeof profile.canonical.contact !== "object") {
    profile.canonical.contact = {};
  }

  const existingRow = await env.DB.prepare(
    "SELECT data FROM profiles WHERE user_id = ?"
  )
    .bind(data.userId)
    .first();
  let existing = {};
  if (existingRow && existingRow.data) {
    try {
      existing = JSON.parse(existingRow.data);
    } catch {
      existing = {};
    }
  }

  // Preserve apply-email fields (client may omit them).
  if (!String(profile.apply_email || "").trim() && existing.apply_email) {
    profile.apply_email = existing.apply_email;
  }
  if (
    profile.apply_email_forward_to_personal === undefined &&
    existing.apply_email_forward_to_personal !== undefined
  ) {
    profile.apply_email_forward_to_personal =
      existing.apply_email_forward_to_personal;
  }
  if (!profile.apply_email_assigned_at && existing.apply_email_assigned_at) {
    profile.apply_email_assigned_at = existing.apply_email_assigned_at;
  }

  // Preserve existing ATS passwords across My Info saves.
  let existingCreds = {};
  const c =
    existing &&
    existing.canonical &&
    typeof existing.canonical === "object"
      ? existing.canonical.ats_credentials
      : null;
  if (c && typeof c === "object") existingCreds = c;

  if (
    !profile.canonical.ats_credentials ||
    typeof profile.canonical.ats_credentials !== "object"
  ) {
    profile.canonical.ats_credentials = {};
  }
  const next = profile.canonical.ats_credentials;
  if (!String(next.password || "").trim() && existingCreds.password) {
    next.password = existingCreds.password;
  }
  if (
    !String(next.password_backup || "").trim() &&
    existingCreds.password_backup
  ) {
    next.password_backup = existingCreds.password_backup;
  }
  ensureAtsCredentials(profile.canonical);

  let existingOnboarding = {};
  if (existing.onboarding && typeof existing.onboarding === "object") {
    existingOnboarding = existing.onboarding;
  }
  if (!profile.onboarding || typeof profile.onboarding !== "object") {
    profile.onboarding = {};
  }
  if (existingOnboarding.welcomeEmailSent && !profile.onboarding.welcomeEmailSent) {
    profile.onboarding.welcomeEmailSent = true;
    if (existingOnboarding.welcomeEmailSentAt) {
      profile.onboarding.welcomeEmailSentAt = existingOnboarding.welcomeEmailSentAt;
    }
  }

  const ensured = await ensureApplyEmail(env, {
    userId: data.userId,
    profile,
    firstName: profile.first_name,
    lastName: profile.last_name,
  });
  Object.assign(profile, ensured.profile);
  syncCanonicalApplyEmail(profile);
  // Keep personal Clerk email discoverable without using it on forms.
  if (data.email) {
    profile.canonical.contact.personal_email = data.email;
  }

  await env.DB.prepare(
    "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  )
    .bind(data.userId, JSON.stringify(profile))
    .run();

  return json({ ok: true, applyEmail: profile.apply_email || null });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
