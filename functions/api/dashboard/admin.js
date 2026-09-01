export async function onRequestGet(context) {
  const { env, data } = context;

  if (data.userId !== env.ADMIN_USER_ID) {
    return json({ error: "Not authorized" }, 403);
  }

  const { results: users } = await env.DB.prepare(
    "SELECT id, email, created_at FROM users ORDER BY created_at DESC"
  ).all();

  const { results: jobs } = await env.DB.prepare(
    "SELECT id, user_id, job_url, status, created_at, completed_at FROM jobs ORDER BY created_at DESC"
  ).all();

  const byUser = users.map((u) => ({
    ...u,
    jobs: jobs.filter((j) => j.user_id === u.id),
  }));

  return json({ users: byUser });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
