import { ensureAtsCredentials } from "../_ats_passwords.js";

export async function onRequestGet(context) {
  const { env, data } = context;

  const row = await env.DB.prepare(
    "SELECT data FROM profiles WHERE user_id = ?"
  )
    .bind(data.userId)
    .first();

  return json({ profile: row ? JSON.parse(row.data) : {} });
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

  // Stamp Clerk identity onto the blob so the worker always has email /
  // user_id even if the client left contact.email blank.
  if (!profile.canonical || typeof profile.canonical !== "object") {
    profile.canonical = {};
  }
  profile.canonical.user_id = data.userId;
  if (!profile.canonical.contact || typeof profile.canonical.contact !== "object") {
    profile.canonical.contact = {};
  }
  if (data.email) {
    profile.canonical.contact.email = data.email;
  }

  // Preserve existing ATS passwords across My Info saves (client canonical
  // does not include them). Generate once if this user has none yet.
  const existingRow = await env.DB.prepare(
    "SELECT data FROM profiles WHERE user_id = ?"
  )
    .bind(data.userId)
    .first();
  let existingCreds = {};
  if (existingRow && existingRow.data) {
    try {
      const existing = JSON.parse(existingRow.data);
      const c =
        existing &&
        existing.canonical &&
        typeof existing.canonical === "object"
          ? existing.canonical.ats_credentials
          : null;
      if (c && typeof c === "object") existingCreds = c;
    } catch {
      existingCreds = {};
    }
  }
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

  // Preserve welcome-email stamp if a concurrent My Info save races the
  // welcome endpoint (client may still have welcomeEmailSent: false).
  let existingOnboarding = {};
  if (existingRow && existingRow.data) {
    try {
      const existing = JSON.parse(existingRow.data);
      if (existing && existing.onboarding && typeof existing.onboarding === "object") {
        existingOnboarding = existing.onboarding;
      }
    } catch {
      existingOnboarding = {};
    }
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

  await env.DB.prepare(
    "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  )
    .bind(data.userId, JSON.stringify(profile))
    .run();

  return json({ ok: true });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
