// GET /api/worker/profile?userId=<clerkUserId>
// Returns the D1 profile blob + extracted canonical for the fill worker.

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

  const canonical =
    profile && typeof profile.canonical === "object" && profile.canonical
      ? profile.canonical
      : null;

  // Ensure worker always sees email somewhere useful
  if (canonical) {
    if (!canonical.contact) canonical.contact = {};
    if (!canonical.contact.email && user.email) {
      canonical.contact.email = user.email;
    }
    canonical.user_id = canonical.user_id || userId;
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
