// POST /api/dashboard/billing/auto-reload  { enabled: true|false }
// Turning it on needs a card already saved by a checkout with auto-reload.
import { getBillingRow } from "../_billing.js";

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
  const enabled = body.enabled === true;

  const row = await getBillingRow(env, data.userId);
  if (!row) {
    return json({ error: "Billing is still being set up. Please try again soon." }, 503);
  }
  if (enabled && !row.stripe_payment_method) {
    return json({ error: "Add a card first.", needs_card: true }, 400);
  }

  await env.DB.prepare(
    "UPDATE users SET auto_reload = ?, auto_reload_error = NULL WHERE id = ?"
  )
    .bind(enabled ? 1 : 0, data.userId)
    .run();
  return json({ ok: true, auto_reload: enabled });
}
