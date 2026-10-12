// GET /api/dashboard/billing
// Everything the Billing page needs: jobs left, card on file, auto-reload
// state, and payment history.
import { getAllotment } from "./_job_limit.js";
import {
  getBillingRow,
  PACK_JOBS,
  PACK_PRICE_CENTS,
  RELOAD_BELOW,
} from "./_billing.js";
import { stripeConfigured } from "../_stripe.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const allot = await getAllotment(env, data.userId);
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
    unlimited: allot.unlimited,
    used: allot.used,
    limit: allot.limit,
    remaining: allot.unlimited ? null : Math.max(0, allot.limit - allot.used),
    auto_reload: !!(row && row.auto_reload),
    auto_reload_error: (row && row.auto_reload_error) || null,
    card:
      row && row.stripe_payment_method
        ? { brand: row.card_brand || "", last4: row.card_last4 || "" }
        : null,
    pack: { jobs: PACK_JOBS, price_cents: PACK_PRICE_CENTS, currency: "CAD" },
    reload_below: RELOAD_BELOW,
    history,
  });
}
