// POST /api/dashboard/referral  { code }
// Applies a referral code to the signed-in user's new account: 5 more free
// applications that never expire. Once per account, before the first purchase.
import { applyReferral, accountSummary } from "./_billing.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const result = await applyReferral(env, data.userId, data.email, body.code);
  if (!result.ok) return json({ error: result.error }, 400);
  return json({ ok: true, code: result.code, bonus: result.bonus, usage: await accountSummary(env, data.userId) });
}
