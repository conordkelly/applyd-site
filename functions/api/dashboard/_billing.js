// Billing helpers shared by the billing endpoints, the Stripe webhook, the
// job-submit endpoint, the referral endpoint and the admin list.
//
// Model
//   Applications are bought in one-time packs (PACKS). They never expire while
//   Applyd is operating. New accounts get a free trial (TRIAL_APPS, 7 days);
//   a referral code adds REFERRAL_BONUS more that never expire. Optional
//   auto-reload: when a submission leaves the user with fewer than
//   AUTO_RELOAD_BELOW applications, the saved card is charged for the pack the
//   user picked (10, 25 or 50).
//
//   Balances use users.job_limit / users.job_reset_at (see _job_limit.js):
//     remaining = job_limit - jobs used since job_reset_at
//   Buying a pack or getting the bonus adds to job_limit.
//
//   Referrals: a code (REFERRAL_CODES) is applied once per new account, before
//   the first purchase. Nothing is paid out by the site: the Admin tab just
//   shows which user used which code (users.referred_by_code, referred_at) and
//   when they made their first purchase (earliest stripe_payments row).
//
// Columns/tables come from migrations/2026-10-12-billing.sql,
// 2026-10-14-plans.sql and 2026-10-24-packs.sql. Reads tolerate them being
// missing so the rest of the site keeps working before a migration has run.
import { DEFAULT_JOB_LIMIT, getAllotment } from "./_job_limit.js";
import { stripeRequest, stripeConfigured } from "../_stripe.js";

export const CURRENCY = "cad";
export const PACKS = {
  10: { jobs: 10, cents: 499 },
  25: { jobs: 25, cents: 1099 },
  50: { jobs: 50, cents: 1999 },
};
export const AUTO_RELOAD_BELOW = 5;
export const TRIAL_APPS = 5;
export const REFERRAL_BONUS = 5;

// code -> who it belongs to. ownerEmail (optional) blocks that person from
// using their own code.
export const REFERRAL_CODES = {
  APPLYDWILL: { owner: "Will", ownerEmail: null },
  APPLYDAIDEN: { owner: "Aiden", ownerEmail: null },
  APPLYDHUGH: { owner: "Hugh", ownerEmail: null },
  APPLYDCONOR: { owner: "Conor", ownerEmail: null },
};

export function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

export function packForJobs(n) {
  return PACKS[Number(n)] || null;
}

// What did a completed Checkout buy? Metadata first, checked against the price
// actually paid; falls back to the amount (also covers the older $2.99 pack and
// $6.99 top-up so a late webhook for those still credits correctly).
export function jobsFromPayment(metaJobs, amountCents) {
  const m = packForJobs(metaJobs);
  if (m && m.cents === amountCents) return m.jobs;
  for (const k of Object.keys(PACKS)) if (PACKS[k].cents === amountCents) return PACKS[k].jobs;
  if (amountCents === 299) return 25;
  if (amountCents === 699 && Number(metaJobs) === 10) return 10;
  return null;
}

// "2026-10-12 17:03:11" (D1, UTC) -> "2026-10-12T17:03:11Z"; null stays null.
export function toIso(sqlDate) {
  if (!sqlDate) return null;
  const s = String(sqlDate);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}

const BASE_COLS =
  "stripe_customer_id, stripe_payment_method, card_brand, card_last4, auto_reload, auto_reload_error, plan, plan_apps, trial_expires_at";

export async function getBillingRow(env, userId) {
  try {
    return (
      (await env.DB.prepare(
        "SELECT " + BASE_COLS + ", auto_reload_jobs, referred_by_code FROM users WHERE id = ?"
      )
        .bind(userId)
        .first()) || null
    );
  } catch (e) {
    // packs migration not run yet: base columns, default reload size, no referral
  }
  try {
    const row = await env.DB.prepare("SELECT " + BASE_COLS + " FROM users WHERE id = ?")
      .bind(userId)
      .first();
    return row ? { ...row, auto_reload_jobs: 10, referred_by_code: null } : null;
  } catch (e) {
    return null; // billing columns not added yet
  }
}

async function hasPurchase(env, userId) {
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM stripe_payments WHERE user_id = ?")
      .bind(userId)
      .first();
    return !!(r && r.n > 0);
  } catch (e) {
    return false;
  }
}

// One object with everything the UI needs about a user's applications.
export async function accountSummary(env, userId) {
  const allot = await getAllotment(env, userId);
  const row = await getBillingRow(env, userId);
  const isTrial = !!(row && row.plan === "trial");
  const trialActive = isTrial && !allot.trialExpired && !allot.unlimited;
  const out = {
    used: allot.used,
    limit: allot.limit,
    unlimited: allot.unlimited,
    remaining: allot.unlimited ? null : Math.max(0, allot.limit - allot.used),
    plan: isTrial ? "trial" : null,
    trial_active: trialActive,
    trial_expired: !!allot.trialExpired,
    trial_expires_at: row ? toIso(row.trial_expires_at) : null,
    trial_remaining: trialActive ? Math.max(0, allot.trialApps - allot.used) : 0,
    auto_reload: !!(row && row.auto_reload),
    auto_reload_jobs: row && packForJobs(row.auto_reload_jobs) ? Number(row.auto_reload_jobs) : 10,
    auto_reload_error: (row && row.auto_reload_error) || null,
    referral_code: row ? row.referred_by_code || null : null,
    can_refer: false,
  };
  if (isTrial && row && !row.referred_by_code && !allot.unlimited) {
    out.can_refer = !(await hasPurchase(env, userId));
  }
  return out;
}

// Adds applications for one payment, exactly once per Stripe PaymentIntent id.
// Returns true if this call credited, false if it was a repeat.
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

// Applies a referral code to a new account: REFERRAL_BONUS free applications
// that never expire. Allowed once, on trial accounts, before any purchase.
// Returns { ok: true, code } or { ok: false, error }.
export async function applyReferral(env, userId, userEmail, rawCode) {
  const code = normalizeCode(rawCode);
  const cfg = REFERRAL_CODES[code];
  if (!cfg) return { ok: false, error: "That referral code is not valid." };
  if (cfg.ownerEmail && userEmail && cfg.ownerEmail.toLowerCase() === String(userEmail).toLowerCase()) {
    return { ok: false, error: "You cannot use your own referral code." };
  }
  let res;
  try {
    res = await env.DB.prepare(
      "UPDATE users SET referred_by_code = ?, referred_at = datetime('now'), job_limit = CASE WHEN job_limit IS NULL THEN ? WHEN job_limit < 0 THEN job_limit ELSE job_limit + ? END WHERE id = ? AND plan = 'trial' AND referred_by_code IS NULL AND NOT EXISTS (SELECT 1 FROM stripe_payments WHERE user_id = ?)"
    )
      .bind(code, DEFAULT_JOB_LIMIT + REFERRAL_BONUS, REFERRAL_BONUS, userId, userId)
      .run();
  } catch (e) {
    return { ok: false, error: "Referral codes are not available yet. Please try again soon." };
  }
  if (res && res.meta && res.meta.changes > 0) return { ok: true, code, bonus: REFERRAL_BONUS };
  const row = await getBillingRow(env, userId);
  if (row && row.referred_by_code) return { ok: false, error: "You already used a referral code." };
  if (row && row.plan !== "trial") return { ok: false, error: "Referral codes are for new accounts." };
  return { ok: false, error: "Referral codes only work before your first purchase." };
}

async function turnOffAutoReload(env, userId, message) {
  try {
    await env.DB.prepare("UPDATE users SET auto_reload = 0, auto_reload_error = ? WHERE id = ?")
      .bind(message, userId)
      .run();
  } catch (e) {
    console.log("auto-reload off:", String(e && e.message ? e.message : e));
  }
}

// Called after a job submission. If the user has auto-reload on, a saved card,
// and is now under AUTO_RELOAD_BELOW applications, charges the pack they chose.
// Never throws. Returns "reloaded", "failed" or null (nothing to do).
export async function maybeAutoReload(env, userId) {
  try {
    if (!stripeConfigured(env)) return null;
    const row = await getBillingRow(env, userId);
    if (!row || !row.auto_reload || !row.stripe_customer_id || !row.stripe_payment_method) return null;
    const pack = packForJobs(row.auto_reload_jobs) || PACKS[10];
    const allot = await getAllotment(env, userId);
    if (allot.unlimited) return null;
    if (allot.limit - allot.used >= AUTO_RELOAD_BELOW) return null;

    // Same key for the same balance: two submissions racing each other get the
    // same PaymentIntent back, and creditPayment dedupes on its id.
    const r = await stripeRequest(
      env,
      "POST",
      "/v1/payment_intents",
      {
        amount: pack.cents,
        currency: CURRENCY,
        customer: row.stripe_customer_id,
        payment_method: row.stripe_payment_method,
        off_session: "true",
        confirm: "true",
        description: "Applyd - " + pack.jobs + " applications (auto-reload)",
        metadata: { user_id: userId, kind: "auto", jobs: String(pack.jobs) },
      },
      { idempotencyKey: "autoreload-" + userId + "-" + allot.limit + "-" + pack.jobs }
    );

    if (r.ok && r.data && r.data.status === "succeeded") {
      await creditPayment(env, {
        paymentIntentId: r.data.id,
        userId,
        jobs: pack.jobs,
        amountCents: pack.cents,
        kind: "auto",
      });
      return "reloaded";
    }

    await turnOffAutoReload(
      env,
      userId,
      "Auto-reload turned off because your card could not be charged. Update your card, then turn it back on."
    );
    return "failed";
  } catch (e) {
    console.log("auto-reload:", String(e && e.message ? e.message : e));
    return null;
  }
}

export async function saveCard(env, userId, customerId, pm) {
  const card = (pm && pm.card) || {};
  await env.DB.prepare(
    "UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_payment_method = ?, card_brand = ?, card_last4 = ? WHERE id = ?"
  )
    .bind(customerId || null, pm.id, card.brand || null, card.last4 || null, userId)
    .run();
}
