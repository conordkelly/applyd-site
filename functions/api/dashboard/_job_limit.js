// Per-user job allotment.
// Used = jobs the user submitted since their last admin reset, excluding
// ones marked Unable to Process (rejected_at set) — those don't use up
// allotment. Limit = users.job_limit, or DEFAULT_JOB_LIMIT when unset;
// a negative job_limit means unlimited (limit comes back null, unlimited true).
// Both columns come from migrations/2026-10-08-job-allotment.sql; every
// read falls back to "default limit, no reset" if they don't exist yet.
export const DEFAULT_JOB_LIMIT = 50;

// Free trial applications expire; everything else (purchased packs, referral
// bonus, older users' default) never does. Trial applications are used first,
// so when the trial runs out, only the unused part of them disappears:
//   effective limit = limit - max(0, trialApps - used)
// Pure so it can be tested on its own.
export function effectiveLimit(limit, used, trialApps, trialExpired) {
  limit = Number(limit);
  if (!trialExpired || limit < 0) return limit;
  return limit - Math.max(0, (Number(trialApps) || 0) - (Number(used) || 0));
}

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
  // Free trial: its applications are only good until trial_expires_at.
  let trialExpired = false;
  let trialApps = 0;
  try {
    const t = await env.DB.prepare(
      "SELECT plan, plan_apps, trial_expires_at FROM users WHERE id = ?"
    ).bind(userId).first();
    if (t && t.plan === "trial" && limit >= 0) {
      trialApps = Number(t.plan_apps) || 0;
      if (t.trial_expires_at) {
        const when = Date.parse(String(t.trial_expires_at).replace(" ", "T") + "Z");
        if (Number.isFinite(when) && when < Date.now()) trialExpired = true;
      }
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
  limit = effectiveLimit(limit, used, trialApps, trialExpired);
  return { used, limit: limit < 0 ? null : limit, unlimited: limit < 0, resetAt, trialExpired, trialApps };
}
