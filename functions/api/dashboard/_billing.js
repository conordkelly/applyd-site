// Pay-as-you-go billing helpers shared by the billing endpoints, the Stripe
// webhook and the job-submit endpoint.
//
// Model: one pack = PACK_JOBS jobs for PACK_PRICE_CENTS (CAD). Buying a pack
// raises users.job_limit by PACK_JOBS, same as the Admin "Add jobs" button.
// Auto-reload: when a submission leaves the user under RELOAD_BELOW jobs,
// the card saved at checkout is charged for one more pack.
//
// Columns/table come from migrations/2026-10-12-billing.sql. Every read here
// tolerates them being missing so the rest of the site works before the
// migration has run.
import { DEFAULT_JOB_LIMIT, getAllotment } from "./_job_limit.js";
import { stripeConfigured, stripeRequest } from "../_stripe.js";

export const PACK_JOBS = 25;
export const PACK_PRICE_CENTS = 299;
export const CURRENCY = "cad";
export const RELOAD_BELOW = 10;

export async function getBillingRow(env, userId) {
  try {
    return (
      (await env.DB.prepare(
        "SELECT stripe_customer_id, stripe_payment_method, card_brand, card_last4, auto_reload, auto_reload_error FROM users WHERE id = ?"
      )
        .bind(userId)
        .first()) || null
    );
  } catch (e) {
    return null; // billing columns not added yet
  }
}

export async function getAutoReload(env, userId) {
  const row = await getBillingRow(env, userId);
  return !!(row && row.auto_reload);
}

// Adds jobs for one payment, exactly once per Stripe PaymentIntent id.
// Returns true if this call credited, false if it was already credited.
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

async function turnOffAutoReload(env, userId, message) {
  try {
    await env.DB.prepare(
      "UPDATE users SET auto_reload = 0, auto_reload_error = ? WHERE id = ?"
    )
      .bind(message, userId)
      .run();
  } catch (e) {
    console.log("auto-reload off:", String(e && e.message ? e.message : e));
  }
}

// Called after a job submission. Charges one pack if the user has auto-reload
// on, a saved card, and is now under RELOAD_BELOW jobs. Never throws.
// Returns "reloaded", "failed" or null (nothing to do).
export async function maybeAutoReload(env, userId) {
  try {
    if (!stripeConfigured(env)) return null;
    const row = await getBillingRow(env, userId);
    if (!row || !row.auto_reload || !row.stripe_customer_id || !row.stripe_payment_method) {
      return null;
    }
    const allot = await getAllotment(env, userId);
    if (allot.unlimited) return null;
    if (allot.limit - allot.used >= RELOAD_BELOW) return null;

    // Same key for the same limit value: two submissions racing each other
    // get the same PaymentIntent back, and creditPayment dedupes on its id.
    const r = await stripeRequest(
      env,
      "POST",
      "/v1/payment_intents",
      {
        amount: PACK_PRICE_CENTS,
        currency: CURRENCY,
        customer: row.stripe_customer_id,
        payment_method: row.stripe_payment_method,
        off_session: "true",
        confirm: "true",
        description: PACK_JOBS + " automated applications (auto-reload)",
        metadata: { user_id: userId, kind: "auto" },
      },
      { idempotencyKey: "autoreload-" + userId + "-" + allot.limit }
    );

    if (r.ok && r.data && r.data.status === "succeeded") {
      await creditPayment(env, {
        paymentIntentId: r.data.id,
        userId,
        jobs: PACK_JOBS,
        amountCents: PACK_PRICE_CENTS,
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
