// Per-user job allotment.
// Used = jobs the user submitted since their last admin reset, excluding
// ones marked Unable to Process (rejected_at set) — those don't use up
// allotment. Limit = users.job_limit, or DEFAULT_JOB_LIMIT when unset;
// a negative job_limit means unlimited (limit comes back null, unlimited true).
// Both columns come from migrations/2026-10-08-job-allotment.sql; every
// read falls back to "default limit, no reset" if they don't exist yet.
export const DEFAULT_JOB_LIMIT = 50;

export async function getAllotment(env, userId) {
  let limit = DEFAULT_JOB_LIMIT;
  let resetAt = null;
  try {
    const u = await env.DB.prepare(
      "SELECT job_limit, job_reset_at FROM users WHERE id = ?"
    ).bind(userId).first();
    if (u) {
      if (u.job_limit != null) limit = Number(u.job_limit); // negative = unlimited
      resetAt = u.job_reset_at || null;
    }
  } catch (e) {
    // columns not added yet — defaults
  }
  // Free trial: the trial applications are only good until trial_expires_at.
  // After that nothing is left, so the limit collapses to whatever was used.
  let trialExpired = false;
  try {
    const t = await env.DB.prepare(
      "SELECT plan, trial_expires_at FROM users WHERE id = ?"
    ).bind(userId).first();
    if (t && t.plan === "trial" && t.trial_expires_at && limit >= 0) {
      const when = Date.parse(String(t.trial_expires_at).replace(" ", "T") + "Z");
      if (Number.isFinite(when) && when < Date.now()) trialExpired = true;
    }
  } catch (e) {
    // plan columns not added yet
  }
  let n;
  const where = "user_id = ? AND rejected_at IS NULL" + (resetAt ? " AND created_at > ?" : "");
  const args = resetAt ? [userId, resetAt] : [userId];
  try {
    n = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE " + where).bind(...args).first();
  } catch (e) {
    n = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ?").bind(userId).first();
  }
  const used = (n && n.n) || 0;
  if (trialExpired) limit = used;
  return { used, limit: limit < 0 ? null : limit, unlimited: limit < 0, resetAt, trialExpired };
}
