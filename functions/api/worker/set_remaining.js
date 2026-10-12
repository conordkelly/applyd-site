// ONE-OFF: POST { user_id, remaining } sets that user's job_limit so exactly
// `remaining` jobs are left (used for testing auto-reload). Worker-key
// protected via functions/api/worker/_middleware.js. Delete after it runs.
export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  const userId = String(body.user_id || "").trim();
  const remaining = Math.floor(Number(body.remaining));
  if (!userId || !Number.isFinite(remaining)) {
    return new Response(JSON.stringify({ error: "user_id and remaining required" }), { status: 400 });
  }
  await env.DB.prepare(
    "UPDATE users SET job_limit = (SELECT COUNT(*) FROM jobs WHERE jobs.user_id = users.id AND jobs.rejected_at IS NULL AND jobs.created_at > COALESCE(users.job_reset_at, '')) + ? WHERE id = ?"
  ).bind(remaining, userId).run();
  const u = await env.DB.prepare(
    "SELECT job_limit, auto_reload, card_last4 FROM users WHERE id = ?"
  ).bind(userId).first();
  return new Response(JSON.stringify({ ok: true, user: u }), {
    headers: { "Content-Type": "application/json" },
  });
}
