// Per-user job allotment.
// Used = jobs the user submitted since their last admin reset, excluding
// ones marked Unable to Process (rejected_at set) — those don't use up
// allotment. Limit = users.job_limit, or DEFAULT_JOB_LIMIT when unset.
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
      if (u.job_limit != null && Number(u.job_limit) >= 0) limit = Number(u.job_limit);
      resetAt = u.job_reset_at || null;
    }
  } catch (e) {
    // columns not added yet — defaults
  }
  let n;
  const where = "user_id = ? AND rejected_at IS NULL" + (resetAt ? " AND created_at > ?" : "");
  const args = resetAt ? [userId, resetAt] : [userId];
  try {
    n = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE " + where).bind(...args).first();
  } catch (e) {
    n = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ?").bind(userId).first();
  }
  return { used: (n && n.n) || 0, limit, resetAt };
}
