// ONE-OFF: POST { user_id } clears that one user's saved Stripe customer and
// card and turns auto-reload off (used when moving from sandbox to live keys).
// Update only, no deletes. Worker-key protected via
// functions/api/worker/_middleware.js. Delete after it runs.
export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  const userId = String(body.user_id || "").trim();
  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id required" }), { status: 400 });
  }
  const r = await env.DB.prepare(
    "UPDATE users SET stripe_customer_id = NULL, stripe_payment_method = NULL, card_brand = NULL, card_last4 = NULL, auto_reload = 0, auto_reload_error = NULL WHERE id = ?"
  ).bind(userId).run();
  return new Response(JSON.stringify({ ok: true, changes: r.meta && r.meta.changes }), {
    headers: { "Content-Type": "application/json" },
  });
}
