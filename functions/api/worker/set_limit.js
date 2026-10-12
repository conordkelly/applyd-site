// ONE-OFF: POST { user_id, limit } sets that user's job_limit and resets their
// usage to 0 (used for testing billing). Worker-key protected via
// functions/api/worker/_middleware.js. Delete after it runs.
export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  const userId = String(body.user_id || "").trim();
  const limit = Math.floor(Number(body.limit));
  if (!userId || !Number.isFinite(limit)) {
    return new Response(JSON.stringify({ error: "user_id and limit required" }), { status: 400 });
  }
  const r = await env.DB.prepare(
    "UPDATE users SET job_limit = ?, job_reset_at = datetime('now') WHERE id = ?"
  ).bind(limit, userId).run();
  return new Response(JSON.stringify({ ok: true, changes: r.meta && r.meta.changes }), {
    headers: { "Content-Type": "application/json" },
  });
}
