// GET /api/dashboard/billing
// Everything the Billing page needs: applications left, card on file, the
// packs for sale, auto-reload settings, and payment history.
import { accountSummary, getBillingRow, PACKS, AUTO_RELOAD_BELOW } from "./_billing.js";
import { stripeConfigured } from "../_stripe.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const acct = await accountSummary(env, data.userId);
  const row = await getBillingRow(env, data.userId);

  let history = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT jobs, amount_cents, kind, created_at FROM stripe_payments WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 25"
    )
      .bind(data.userId)
      .all();
    history = (results || []).map((r) => ({
      jobs: r.jobs,
      amount_cents: r.amount_cents,
      kind: r.kind,
      created_at: r.created_at,
    }));
  } catch (e) {
    history = []; // table not created yet
  }

  return json({
    configured: stripeConfigured(env),
    ready: !!row,
    ...acct,
    card:
      row && row.stripe_payment_method
        ? { brand: row.card_brand || "", last4: row.card_last4 || "" }
        : null,
    packs: Object.keys(PACKS).map((k) => ({ jobs: PACKS[k].jobs, price_cents: PACKS[k].cents })),
    reload_below: AUTO_RELOAD_BELOW,
    history,
  });
}
