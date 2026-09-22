// GET /api/worker/profile?userId=<clerkUserId>
// Returns the D1 profile blob + extracted canonical for the fill worker.

import { ensureAtsCredentials } from "../_ats_passwords.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const userId = (url.searchParams.get("userId") || "").trim();

  if (!userId) {
    return json({ error: "userId query param is required" }, 400);
  }

  const user = await env.DB.prepare(
    "SELECT id, email, created_at FROM users WHERE id = ?"
  )
    .bind(userId)
    .first();

  if (!user) {
    return json({ error: "User not found" }, 404);
  }

  const row = await env.DB.prepare(
    "SELECT data, updated_at FROM profiles WHERE user_id = ?"
  )
    .bind(userId)
    .first();

  let profile = {};
  if (row && row.data) {
    try {
      profile = JSON.parse(row.data);
    } catch {
      return json({ error: "Profile JSON is corrupt" }, 500);
    }
  }

  let canonical =
    profile && typeof profile.canonical === "object" && profile.canonical
      ? profile.canonical
      : {};

  // Ensure worker always sees email somewhere useful
  if (!canonical.contact) canonical.contact = {};
  if (!canonical.contact.email && user.email) {
    canonical.contact.email = user.email;
  }
  canonical.user_id = canonical.user_id || userId;

  // Mint stable ATS passwords if this profile never got them (older users).
  const { created, canonical: withCreds } = ensureAtsCredentials(canonical);
  canonical = withCreds;
  profile.canonical = canonical;

  if (created) {
    await env.DB.prepare(
      "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
    )
      .bind(userId, JSON.stringify(profile))
      .run();
  }

  return json({
    user: { id: user.id, email: user.email, created_at: user.created_at },
    profile,
    canonical,
    profile_updated_at: row ? row.updated_at : null,
    resume: {
      url: "/api/worker/resume?userId=" + encodeURIComponent(userId),
      upload_filename:
        (canonical &&
          canonical.assets &&
          canonical.assets.resume_upload_filename) ||
        profile.resume_upload_filename ||
        null,
      has_file: !!(
        (canonical && canonical.assets && canonical.assets.resume_url) ||
        profile.resume_upload_filename
      ),
    },
  });
}
