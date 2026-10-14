// Subscription billing helpers shared by the billing endpoints, the Stripe
// webhook, the job-submit endpoint and the admin list.
//
// Model
//   Plans are monthly subscriptions: Starter 15 applications, Plus 40. Launch
//   pricing (first LAUNCH_SPOTS subscribers) is locked into the subscription's
//   price for as long as it stays subscribed. Plan applications reset every
//   renewal; unused ones are lost. Top-up packs (TOPUP.apps for TOPUP.cents)
//   never expire and are used after the plan's applications.
//
//   Balances reuse users.job_limit / users.job_reset_at (see _job_limit.js):
//     remaining = job_limit - jobs used since job_reset_at
//   Plan applications are used first, so
//     plan remaining   = max(0, plan_apps - used)
//     top-up remaining = max(0, job_limit - max(used, plan_apps))
//   At each renewal: reset usage and set
//     job_limit = new plan_apps + top-up remaining.
//
// Columns/table come from migrations/2026-10-14-plans.sql (plus the older
// 2026-10-12-billing.sql). Reads tolerate them being missing so the rest of
// the site keeps working before the migration has run.
import { DEFAULT_JOB_LIMIT, getAllotment } from "./_job_limit.js";
import { stripeRequest } from "../_stripe.js";

export const CURRENCY = "cad";
export const LAUNCH_SPOTS = 15;
export const PLANS = {
  starter: { id: "starter", name: "Starter", apps: 15, launch_cents: 699, regular_cents: 999 },
  plus: { id: "plus", name: "Plus", apps: 40, launch_cents: 1699, regular_cents: 2999 },
};
export const TOPUP = { apps: 10, cents: 699 };
export const TRIAL_APPS = 3;

export function planFromApps(n) {
  n = Number(n);
  return n === PLANS.starter.apps ? "starter" : n === PLANS.plus.apps ? "plus" : null;
}

export function isPaidPlan(plan) {
  return plan === "starter" || plan === "plus";
}

export function planPriceCents(planId, launch) {
  const p = PLANS[planId];
  if (!p) return null;
  return launch ? p.launch_cents : p.regular_cents;
}

// Split a user's remaining applications into plan and top-up parts.
export function splitBalance(limit, used, planApps) {
  limit = Number(limit) || 0;
  used = Number(used) || 0;
  planApps = Number(planApps) || 0;
  return {
    plan: Math.max(0, planApps - used),
    topup: Math.max(0, limit - Math.max(used, planApps)),
  };
}

// "2026-10-12 17:03:11" (D1, UTC) -> "2026-10-12T17:03:11Z"; null stays null.
export function toIso(sqlDate) {
  if (!sqlDate) return null;
  const s = String(sqlDate);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}

export function unixToSql(secs) {
  const n = Number(secs);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 19).replace("T", " ");
}

const BILLING_COLS =
  "stripe_customer_id, stripe_payment_method, card_brand, card_last4, plan, plan_status, plan_apps, plan_launch, launch_used, plan_pending, plan_period_end, stripe_subscription_id, trial_expires_at";

export async function getBillingRow(env, userId) {
  try {
    return (
      (await env.DB.prepare("SELECT " + BILLING_COLS + " FROM users WHERE id = ?")
        .bind(userId)
        .first()) || null
    );
  } catch (e) {
    return null; // billing columns not added yet
  }
}

export async function launchState(env, row) {
  let used = 0;
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE launch_used = 1").first();
    used = (r && r.n) || 0;
  } catch (e) {
    used = 0;
  }
  const mine = !!(row && row.launch_used);
  return { spots_used: used, available: !mine && used < LAUNCH_SPOTS };
}

// One object with everything the UI needs about a user's applications and plan.
export async function accountSummary(env, userId) {
  const allot = await getAllotment(env, userId);
  const row = await getBillingRow(env, userId);
  const plan = row && row.plan ? row.plan : null;
  const planApps = plan && Number(row.plan_apps) > 0 ? Number(row.plan_apps) : 0;
  const out = {
    used: allot.used,
    limit: allot.limit,
    unlimited: allot.unlimited,
    plan,
    plan_name: PLANS[plan] ? PLANS[plan].name : plan === "trial" ? "Free trial" : null,
    plan_status: row ? row.plan_status || null : null,
    plan_apps: planApps,
    plan_launch: !!(row && row.plan_launch),
    plan_pending: row ? row.plan_pending || null : null,
    plan_period_end: row ? toIso(row.plan_period_end) : null,
    trial_expires_at: row ? toIso(row.trial_expires_at) : null,
    trial_expired: !!allot.trialExpired,
    remaining: null,
    plan_remaining: null,
    topup_remaining: null,
  };
  if (!allot.unlimited) {
    out.remaining = Math.max(0, allot.limit - allot.used);
    const sp = splitBalance(allot.limit, allot.used, planApps);
    out.plan_remaining = sp.plan;
    out.topup_remaining = sp.topup;
  }
  return out;
}

// Adds top-up applications for one payment, exactly once per Stripe
// PaymentIntent id. Returns true if this call credited, false if repeat.
// Unlimited users (job_limit < 0) stay unlimited. Legacy users with no
// job_limit start from the old default before the pack is added.
export async function creditPayment(env, p) {
  const res = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO stripe_payments (id, user_id, jobs, amount_cents, kind) VALUES (?, ?, ?, ?, ?)"
    ).bind(p.paymentIntentId, p.userId, p.jobs, p.amountCents, p.kind),
    env.DB.prepare(
      "UPDATE users SET job_limit = CASE WHEN job_limit IS NULL THEN ? WHEN job_limit < 0 THEN job_limit ELSE job_limit + ? END WHERE id = ? AND changes() > 0"
    ).bind(DEFAULT_JOB_LIMIT + p.jobs, p.jobs, p.userId),
  ]);
  return !!(res[0] && res[0].meta && res[0].meta.changes > 0);
}

// Starts or renews a plan period: sets the plan, resets usage and gives the
// plan's applications plus any top-ups carried over. Runs once per invoice id
// (first invoice and every renewal), so the checkout webhook and the
// invoice.paid webhook can both call it safely.
export async function applyPlanCycle(env, p) {
  const plan = PLANS[p.plan];
  if (!plan) throw new Error("unknown plan " + p.plan);
  const allot = await getAllotment(env, p.userId);
  const row = await getBillingRow(env, p.userId);
  if (!row) throw new Error("billing columns missing");
  const oldPlanApps = row.plan && Number(row.plan_apps) > 0 ? Number(row.plan_apps) : 0;
  const carried = allot.unlimited ? 0 : splitBalance(allot.limit, allot.used, oldPlanApps).topup;
  const newLimit = plan.apps + carried;

  const res = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO stripe_payments (id, user_id, jobs, amount_cents, kind) VALUES (?, ?, ?, ?, ?)"
    ).bind(p.invoiceId, p.userId, plan.apps, p.amountCents || 0, p.kind),
    env.DB.prepare(
      "UPDATE users SET plan = ?, plan_status = 'active', plan_apps = ?, plan_launch = ?, launch_used = CASE WHEN ? = 1 THEN 1 ELSE launch_used END, plan_pending = NULL, stripe_subscription_id = ?, plan_period_end = ?, job_limit = CASE WHEN job_limit < 0 THEN job_limit ELSE ? END, job_reset_at = CASE WHEN job_limit < 0 THEN job_reset_at ELSE datetime('now') END WHERE id = ? AND changes() > 0"
    ).bind(
      plan.id,
      plan.apps,
      p.launch ? 1 : 0,
      p.launch ? 1 : 0,
      p.subscriptionId,
      p.periodEnd || null,
      newLimit,
      p.userId
    ),
  ]);
  return !!(res[0] && res[0].meta && res[0].meta.changes > 0);
}

// The subscription is over: drop the plan (and launch price) but keep any
// top-up applications. Only acts if this is the user's current subscription.
export async function endPlan(env, userId, subscriptionId) {
  const row = await getBillingRow(env, userId);
  if (!row || row.stripe_subscription_id !== subscriptionId) return false;
  const allot = await getAllotment(env, userId);
  const oldPlanApps = row.plan && Number(row.plan_apps) > 0 ? Number(row.plan_apps) : 0;
  const topup = allot.unlimited ? 0 : splitBalance(allot.limit, allot.used, oldPlanApps).topup;
  await env.DB.prepare(
    "UPDATE users SET plan = NULL, plan_status = 'canceled', plan_apps = 0, plan_launch = 0, plan_pending = NULL, stripe_subscription_id = NULL, plan_period_end = NULL, job_limit = CASE WHEN job_limit < 0 THEN job_limit ELSE ? END, job_reset_at = CASE WHEN job_limit < 0 THEN job_reset_at ELSE datetime('now') END WHERE id = ?"
  )
    .bind(topup, userId)
    .run();
  return true;
}

export async function saveCard(env, userId, customerId, pm) {
  const card = (pm && pm.card) || {};
  await env.DB.prepare(
    "UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_payment_method = ?, card_brand = ?, card_last4 = ? WHERE id = ?"
  )
    .bind(customerId || null, pm.id, card.brand || null, card.last4 || null, userId)
    .run();
}

// Facts about a Stripe subscription, tolerant of API versions that moved
// current_period_end onto the subscription items.
export async function fetchSubscription(env, subscriptionId) {
  const r = await stripeRequest(
    env,
    "GET",
    "/v1/subscriptions/" + encodeURIComponent(subscriptionId),
    { expand: ["default_payment_method"] }
  );
  if (!r.ok || !r.data) return null;
  const sub = r.data;
  const item = sub.items && sub.items.data && sub.items.data[0];
  const periodEnd = sub.current_period_end || (item && item.current_period_end) || null;
  return {
    id: sub.id,
    status: sub.status,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    metadata: sub.metadata || {},
    periodEndSql: unixToSql(periodEnd),
    customer: typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id,
    itemId: item ? item.id : null,
    paymentMethod:
      sub.default_payment_method && typeof sub.default_payment_method === "object"
        ? sub.default_payment_method
        : null,
  };
}

export function statusFromSubscription(sub) {
  if (sub.status === "past_due" || sub.status === "unpaid") return "past_due";
  return sub.cancelAtPeriodEnd ? "canceling" : "active";
}
