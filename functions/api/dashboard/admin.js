import { accountSummary } from "./_billing.js";

export async function onRequestGet(context) {
  const { env, data } = context;

  if (data.userId !== env.ADMIN_USER_ID) {
    return json({ error: "Not authorized" }, 403);
  }

  const { results: users } = await env.DB.prepare(
    "SELECT id, email, created_at FROM users ORDER BY created_at DESC"
  ).all();

  // rejected_at/rejected_reason: without these, a job pushed to the user's
  // Unable to Process tab still shows "processing" here forever — reject
  // only ever sets rejected_at, never changes the status column itself.
  let jobs;
  try {
    ({ results: jobs } = await env.DB.prepare(
      "SELECT id, user_id, job_url, status, created_at, completed_at, rejected_at, rejected_reason FROM jobs ORDER BY created_at DESC"
    ).all());
  } catch (e) {
    // Pre-migration fallback (rejected_reason column not yet added)
    ({ results: jobs } = await env.DB.prepare(
      "SELECT id, user_id, job_url, status, created_at, completed_at, rejected_at FROM jobs ORDER BY created_at DESC"
    ).all());
  }

  const byUser = await Promise.all(users.map(async (u) => ({
    ...u,
    jobs: jobs.filter((j) => j.user_id === u.id),
    usage: await accountSummary(env, u.id),
  })));

  // Launch and subscription counts (zeros before the plans migration runs).
  const stats = { launch_spots_used: 0, launch_spots: 15, active_subscribers: 0, trials_running: 0 };
  try {
    const q = async (sql) => ((await env.DB.prepare(sql).first()) || {}).n || 0;
    stats.launch_spots_used = await q("SELECT COUNT(*) AS n FROM users WHERE launch_used = 1");
    stats.active_subscribers = await q(
      "SELECT COUNT(*) AS n FROM users WHERE plan IN ('starter','plus') AND plan_status IN ('active','canceling','past_due')"
    );
    stats.trials_running = await q(
      "SELECT COUNT(*) AS n FROM users WHERE plan = 'trial' AND trial_expires_at > datetime('now')"
    );
  } catch (e) {
    // plan columns not added yet
  }

  return json({ users: byUser, stats });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
