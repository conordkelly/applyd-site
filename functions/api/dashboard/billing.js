// GET /api/dashboard/billing
// Everything the Billing page needs: plan, applications left (split into plan
// and top-up), card on file, which plans to offer and at what price, and
// payment history.
import {
  accountSummary,
  getBillingRow,
  launchState,
  isPaidPlan,
  planPriceCents,
  PLANS,
  TOPUP,
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
  const acct = await accountSummary(env, data.userId);
  const row = await getBillingRow(env, data.userId);
  const launch = await launchState(env, row);
  // Someone already on a launch price keeps it on any plan; new subscribers
  // get it while spots last.
  const launchPricing = acct.plan_launch || launch.available;

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

  const plans = Object.keys(PLANS).map((id) => ({
    id,
    name: PLANS[id].name,
    apps: PLANS[id].apps,
    price_cents: planPriceCents(id, launchPricing),
    regular_cents: PLANS[id].regular_cents,
    launch: launchPricing,
  }));

  return json({
    configured: stripeConfigured(env),
    ready: !!row,
    ...acct,
    has_subscription: isPaidPlan(acct.plan),
    plan_price_cents: isPaidPlan(acct.plan) ? planPriceCents(acct.plan, acct.plan_launch) : null,
    plan_regular_cents: isPaidPlan(acct.plan) ? PLANS[acct.plan].regular_cents : null,
    card:
      row && row.stripe_payment_method
        ? { brand: row.card_brand || "", last4: row.card_last4 || "" }
        : null,
    plans,
    topup: { apps: TOPUP.apps, price_cents: TOPUP.cents, currency: "CAD" },
    history,
  });
}
