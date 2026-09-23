// Shared apply-address helpers (everydaymail.ca catch-all).
// Used by dashboard profile/welcome and documented for the email worker.

export const APPLY_EMAIL_DOMAIN = "everydaymail.ca";

/**
 * Ensure D1 tables exist (safe to call repeatedly).
 * @param {D1Database} db
 */
export async function ensureApplyEmailTables(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS apply_email_addresses (
        email TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS apply_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        to_address TEXT NOT NULL,
        from_address TEXT NOT NULL,
        subject TEXT,
        body_text TEXT,
        body_html TEXT,
        received_at TEXT NOT NULL,
        forwarded_at TEXT,
        forward_status TEXT,
        raw_size INTEGER
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_apply_messages_user_received
        ON apply_messages(user_id, received_at DESC)`
    )
    .run();
}

/**
 * @param {string} s
 */
export function normalizeEmailLocalPart(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

/**
 * @param {{ firstName?: string, lastName?: string, userId?: string }} opts
 */
export function buildApplyEmailLocalBase(opts) {
  const first = normalizeEmailLocalPart(opts && opts.firstName);
  const last = normalizeEmailLocalPart(opts && opts.lastName);
  if (first && last) return first + "." + last;
  if (first) return first;
  if (last) return last;
  const id = String((opts && opts.userId) || "")
    .replace(/^user_/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  return id ? "user." + id : "user";
}

function isFallbackApplyEmail(email, userId) {
  const local = String(email || "").split("@")[0] || "";
  return /^user\.[a-z0-9]+$/.test(local);
}

async function allocateApplyEmail(env, opts) {
  const userId = opts.userId;
  const profile = opts.profile || {};
  const base = buildApplyEmailLocalBase({
    firstName: opts.firstName || profile.first_name,
    lastName: opts.lastName || profile.last_name,
    userId,
  });

  let local = base;
  let n = 2;
  let email = local + "@" + APPLY_EMAIL_DOMAIN;
  for (;;) {
    const taken = await env.DB.prepare(
      "SELECT email FROM apply_email_addresses WHERE email = ?"
    )
      .bind(email)
      .first();
    if (!taken) break;
    local = base + String(n);
    n += 1;
    email = local + "@" + APPLY_EMAIL_DOMAIN;
    if (n > 500) {
      email =
        "user." +
        userId.replace(/[^a-zA-Z0-9]/g, "").slice(-16).toLowerCase() +
        "@" +
        APPLY_EMAIL_DOMAIN;
      break;
    }
  }
  return email;
}

/**
 * Assign a unique apply address if the profile doesn't have one yet.
 * Mutates and returns profile. Also upserts apply_email_addresses.
 * If the address is still the user.{id} fallback and first+last name now
 * exist, upgrade once to firstname.lastname@domain.
 *
 * @param {object} env
 * @param {{ userId: string, profile: object, firstName?: string, lastName?: string }} opts
 */
export async function ensureApplyEmail(env, opts) {
  const userId = opts.userId;
  let profile = opts.profile && typeof opts.profile === "object" ? opts.profile : {};
  await ensureApplyEmailTables(env.DB);

  const firstName = opts.firstName || profile.first_name;
  const lastName = opts.lastName || profile.last_name;
  const canUpgrade = !!(
    normalizeEmailLocalPart(firstName) && normalizeEmailLocalPart(lastName)
  );

  let existing = String(profile.apply_email || "").trim().toLowerCase();
  if (!existing) {
    const byUser = await env.DB.prepare(
      "SELECT email FROM apply_email_addresses WHERE user_id = ?"
    )
      .bind(userId)
      .first();
    if (byUser && byUser.email) existing = String(byUser.email).toLowerCase();
  }

  if (existing && !(canUpgrade && isFallbackApplyEmail(existing, userId))) {
    await env.DB.prepare(
      `INSERT INTO apply_email_addresses (email, user_id) VALUES (?, ?)
       ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id`
    )
      .bind(existing, userId)
      .run();
    profile.apply_email = existing;
    if (profile.apply_email_forward_to_personal === undefined) {
      profile.apply_email_forward_to_personal = true;
    }
    if (!profile.apply_email_assigned_at) {
      profile.apply_email_assigned_at = new Date().toISOString();
    }
    syncCanonicalApplyEmail(profile);
    return { profile, created: false, email: existing };
  }

  const email = await allocateApplyEmail(env, {
    userId,
    profile,
    firstName,
    lastName,
  });

  if (existing && existing !== email) {
    await env.DB.prepare(
      "DELETE FROM apply_email_addresses WHERE user_id = ?"
    )
      .bind(userId)
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO apply_email_addresses (email, user_id) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id`
  )
    .bind(email, userId)
    .run();

  profile.apply_email = email;
  profile.apply_email_assigned_at = new Date().toISOString();
  if (profile.apply_email_forward_to_personal === undefined) {
    profile.apply_email_forward_to_personal = true;
  }
  syncCanonicalApplyEmail(profile);
  return { profile, created: existing !== email, email };
}

/**
 * Put apply_email on canonical.contact for the fill worker.
 * @param {object} profile
 */
export function syncCanonicalApplyEmail(profile) {
  if (!profile.canonical || typeof profile.canonical !== "object") {
    profile.canonical = {};
  }
  if (!profile.canonical.contact || typeof profile.canonical.contact !== "object") {
    profile.canonical.contact = {};
  }
  const apply = String(profile.apply_email || "").trim();
  if (apply) {
    profile.canonical.contact.apply_email = apply;
    // Worker form fills should use the apply address, not Clerk personal.
    profile.canonical.contact.email = apply;
  }
  return profile;
}

/**
 * @param {string} email
 */
export function normalizeApplyAddress(email) {
  return String(email || "").trim().toLowerCase();
}
