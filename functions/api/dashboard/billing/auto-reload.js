// POST /api/dashboard/billing/auto-reload  { enabled: true|false, jobs: 10|25|50 }
// Turns auto-reload on or off and sets which pack it reloads with. Turning it
// on needs a card already saved by a purchase made with auto-reload ticked.
import { getBillingRow, packForJobs } from "../_billing.js";

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
  const pack = body.jobs === undefined ? null : packForJobs(body.jobs);
  if (body.jobs !== undefined && !pack) return json({ error: "Pick 10, 25 or 50 applications." }, 400);

  const row = await getBillingRow(env, data.userId);
  if (!row) return json({ error: "Billing is still being set up. Please try again soon." }, 503);
  if (enabled && !row.stripe_payment_method) {
    return json({ error: "Add a card first.", needs_card: true }, 400);
  }
  try {
    await env.DB.prepare(
      "UPDATE users SET auto_reload = ?, auto_reload_error = NULL, auto_reload_jobs = COALESCE(?, auto_reload_jobs) WHERE id = ?"
    )
      .bind(enabled ? 1 : 0, pack ? pack.jobs : null, data.userId)
      .run();
  } catch (e) {
    return json({ error: "Billing is still being set up. Please try again soon." }, 503);
  }
  return json({ ok: true, auto_reload: enabled });
}
