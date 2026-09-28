// GET /api/worker/profile?userId=<clerkUserId>
// Returns the D1 profile blob + extracted canonical for the fill worker.
// PATCH /api/worker/profile
//   { userId, experience_locations: [{ company, role, location }] }
// Sets location on matching experience_roles + canonical.experience.

import { ensureAtsCredentials } from "../_ats_passwords.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function applyExperienceLocations(roles, updates) {
  const list = Array.isArray(roles) ? roles : [];
  const applied = [];
  const missing = [];
  for (const raw of updates) {
    const company = String((raw && raw.company) || "").trim();
    const role = String((raw && raw.role) || "").trim();
    const location = String((raw && raw.location) || "").trim();
    if (!company || !role || !location) {
      missing.push({ company, role, reason: "incomplete" });
      continue;
    }
    const matches = list.filter(
      (r) => norm(r && r.company) === norm(company) && norm(r && r.role) === norm(role)
    );
    if (matches.length !== 1) {
      missing.push({
        company,
        role,
        reason: matches.length ? "ambiguous" : "not_found",
      });
      continue;
    }
    matches[0].location = location;
    applied.push({ company, role, location });
  }
  return { roles: list, applied, missing };
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

  // Prefer apply address for form fills; keep Clerk email as personal.
  if (!canonical.contact) canonical.contact = {};
  const applyEmail =
    (canonical.contact.apply_email &&
      String(canonical.contact.apply_email).trim()) ||
    (profile.apply_email && String(profile.apply_email).trim()) ||
    "";
  if (applyEmail) {
    canonical.contact.apply_email = applyEmail;
    canonical.contact.email = applyEmail;
    if (user.email) canonical.contact.personal_email = user.email;
  } else if (!canonical.contact.email && user.email) {
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

export async function onRequestPatch(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const userId = String((body && body.userId) || "").trim();
  const updates = body && body.experience_locations;
  if (!userId) {
    return json({ error: "userId is required" }, 400);
  }
  if (!Array.isArray(updates) || !updates.length) {
    return json({ error: "experience_locations array is required" }, 400);
  }

  const user = await env.DB.prepare(
    "SELECT id, email FROM users WHERE id = ?"
  )
    .bind(userId)
    .first();
  if (!user) {
    return json({ error: "User not found" }, 404);
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
      return json({ error: "Profile JSON is corrupt" }, 500);
    }
  }

  const rolesResult = applyExperienceLocations(
    profile.experience_roles,
    updates
  );
  if (rolesResult.missing.length) {
    return json(
      {
        error: "Could not match every experience location",
        missing: rolesResult.missing,
      },
      422
    );
  }
  profile.experience_roles = rolesResult.roles;

  if (!profile.canonical || typeof profile.canonical !== "object") {
    profile.canonical = {};
  }
  const canonResult = applyExperienceLocations(
    profile.canonical.experience,
    updates
  );
  if (canonResult.missing.length) {
    return json(
      {
        error: "Could not match every canonical experience location",
        missing: canonResult.missing,
      },
      422
    );
  }
  profile.canonical.experience = canonResult.roles;

  await env.DB.prepare(
    "INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  )
    .bind(userId, JSON.stringify(profile))
    .run();

  return json({
    ok: true,
    applied: rolesResult.applied,
  });
}
