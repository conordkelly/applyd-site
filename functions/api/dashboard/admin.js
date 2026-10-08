import { getAllotment } from "./_job_limit.js";

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
    usage: await getAllotment(env, u.id),
  })));

  return json({ users: byUser });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
