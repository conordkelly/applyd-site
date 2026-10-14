// POST /api/stripe-webhook
// Stripe calls this for billing events. Public route (Stripe is not a
// signed-in user); trust comes from the Stripe-Signature check.
//
// Events handled (add all of these to the webhook destination in Stripe):
//   checkout.session.completed    first plan payment, top-up payment, card update
//   invoice.paid                  plan renewals (and the first invoice, deduped)
//   invoice.payment_failed        mark the plan past due
//   customer.subscription.updated cancel / resume / status changes
//   customer.subscription.deleted subscription ended
//
// Signing secret goes in STRIPE_WEBHOOK_SECRET. Every credit is keyed on a
// Stripe id (invoice or PaymentIntent) so retries and the two events for a
// first payment can never apply twice.
import { stripeRequest, verifyStripeSignature } from "./_stripe.js";
import {
  applyPlanCycle,
  creditPayment,
  endPlan,
  fetchSubscription,
  getBillingRow,
  saveCard,
  statusFromSubscription,
  PLANS,
  TOPUP,
} from "./dashboard/_billing.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function str(v) {
  return typeof v === "string" ? v : v && v.id ? v.id : null;
}

// Start or renew a plan from a subscription's current facts.
async function applySubscription(env, subscriptionId, invoiceId, amountCents, kind) {
  const sub = await fetchSubscription(env, subscriptionId);
  if (!sub) throw new Error("could not read subscription " + subscriptionId);
  const userId = sub.metadata.user_id;
  const plan = sub.metadata.plan;
  if (!userId || !PLANS[plan]) {
    console.log("stripe webhook: subscription without plan metadata", subscriptionId);
    return;
  }
  await applyPlanCycle(env, {
    userId,
    plan,
    launch: sub.metadata.launch === "1",
    subscriptionId,
    invoiceId,
    amountCents,
    kind,
    periodEnd: sub.periodEndSql,
  });
  const status = statusFromSubscription(sub);
  await env.DB.prepare("UPDATE users SET plan_status = ?, stripe_customer_id = COALESCE(?, stripe_customer_id) WHERE id = ? AND stripe_subscription_id = ?")
    .bind(status, sub.customer, userId, subscriptionId)
    .run();
  if (sub.paymentMethod && sub.paymentMethod.id) {
    await saveCard(env, userId, sub.customer, sub.paymentMethod);
  }
}

async function handleCheckoutCompleted(env, session) {
  const userId = session.client_reference_id || (session.metadata && session.metadata.user_id);
  if (!userId) {
    console.log("stripe webhook: session without user", session.id);
    return;
  }
  const customerId = str(session.customer);

  if (session.mode === "subscription") {
    if (session.payment_status !== "paid") return;
    const subId = str(session.subscription);
    const invoiceId = str(session.invoice) || "cs_" + session.id;
    if (!subId) return;
    await applySubscription(env, subId, invoiceId, session.amount_total || 0, "plan");
    return;
  }

  if (session.mode === "payment") {
    if (session.payment_status !== "paid" || !session.payment_intent) return;
    const meta = session.metadata || {};
    // Top-up packs carry their size in metadata. Sessions from the old $2.99
    // pack (no metadata) were 25 applications.
    let jobs = parseInt(meta.jobs, 10);
    if (!Number.isFinite(jobs) || jobs < 1 || jobs > 1000) {
      jobs = session.amount_total === 299 ? 25 : TOPUP.apps;
    }
    await creditPayment(env, {
      paymentIntentId: session.payment_intent,
      userId,
      jobs,
      amountCents: session.amount_total || 0,
      kind: "topup",
    });
    if (customerId) {
      await env.DB.prepare(
        "UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?"
      )
        .bind(customerId, userId)
        .run();
    }
    return;
  }

  if (session.mode === "setup" && session.setup_intent) {
    const r = await stripeRequest(
      env,
      "GET",
      "/v1/setup_intents/" + encodeURIComponent(session.setup_intent),
      { expand: ["payment_method"] }
    );
    const pm = r.ok && r.data && r.data.payment_method;
    if (!pm || !pm.id) return;
    await saveCard(env, userId, customerId, pm);
    // Make it the card the subscription charges, and retry an unpaid invoice.
    const row = await getBillingRow(env, userId);
    if (row && customerId) {
      await stripeRequest(env, "POST", "/v1/customers/" + encodeURIComponent(customerId), {
        invoice_settings: { default_payment_method: pm.id },
      });
    }
    if (row && row.stripe_subscription_id) {
      const subPath = "/v1/subscriptions/" + encodeURIComponent(row.stripe_subscription_id);
      await stripeRequest(env, "POST", subPath, { default_payment_method: pm.id });
      try {
        const got = await stripeRequest(env, "GET", subPath, { expand: ["latest_invoice"] });
        const inv = got.ok && got.data && got.data.latest_invoice;
        if (inv && inv.status === "open") {
          await stripeRequest(env, "POST", "/v1/invoices/" + encodeURIComponent(inv.id) + "/pay", {});
        }
      } catch (e) {
        console.log("retry invoice:", String(e && e.message ? e.message : e));
      }
    }
  }
}

function invoiceSubscriptionId(inv) {
  return (
    str(inv.subscription) ||
    str(inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription) ||
    null
  );
}

async function handleInvoicePaid(env, inv) {
  const subId = invoiceSubscriptionId(inv);
  if (!subId) return;
  // Only a new subscription or a renewal changes applications. Mid-cycle
  // changes (plan switches use no proration) never come through here.
  if (inv.billing_reason !== "subscription_create" && inv.billing_reason !== "subscription_cycle") return;
  const kind = inv.billing_reason === "subscription_create" ? "plan" : "renewal";
  await applySubscription(env, subId, inv.id, inv.amount_paid || 0, kind);
}

async function userForSubscription(env, subscriptionId) {
  try {
    return await env.DB.prepare("SELECT id FROM users WHERE stripe_subscription_id = ?")
      .bind(subscriptionId)
      .first();
  } catch (e) {
    return null;
  }
}

async function handleInvoiceFailed(env, inv) {
  const subId = invoiceSubscriptionId(inv);
  if (!subId) return;
  await env.DB.prepare("UPDATE users SET plan_status = 'past_due' WHERE stripe_subscription_id = ?")
    .bind(subId)
    .run();
}

async function handleSubscriptionUpdated(env, sub) {
  const subId = sub.id;
  const u = await userForSubscription(env, subId);
  if (!u) return; // not applied yet (checkout handler will set everything)
  const item = sub.items && sub.items.data && sub.items.data[0];
  const periodEnd = sub.current_period_end || (item && item.current_period_end) || null;
  const status = statusFromSubscription({
    status: sub.status,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
  });
  const end = periodEnd ? new Date(Number(periodEnd) * 1000).toISOString().slice(0, 19).replace("T", " ") : null;
  await env.DB.prepare(
    "UPDATE users SET plan_status = ?, plan_period_end = COALESCE(?, plan_period_end) WHERE id = ?"
  )
    .bind(status, end, u.id)
    .run();
}

async function handleSubscriptionDeleted(env, sub) {
  const u = await userForSubscription(env, sub.id);
  if (!u) return;
  await endPlan(env, u.id, sub.id);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) return json({ error: "Webhook is not configured" }, 503);

  const raw = await request.text();
  const ok = await verifyStripeSignature(raw, request.headers.get("Stripe-Signature"), secret);
  if (!ok) return json({ error: "Bad signature" }, 400);

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Bad payload" }, 400);
  }

  try {
    const obj = event.data && event.data.object;
    if (event.type === "checkout.session.completed") await handleCheckoutCompleted(env, obj);
    else if (event.type === "invoice.paid") await handleInvoicePaid(env, obj);
    else if (event.type === "invoice.payment_failed") await handleInvoiceFailed(env, obj);
    else if (event.type === "customer.subscription.updated") await handleSubscriptionUpdated(env, obj);
    else if (event.type === "customer.subscription.deleted") await handleSubscriptionDeleted(env, obj);
  } catch (e) {
    // 500 makes Stripe retry; every credit is idempotent.
    console.log("stripe webhook:", event && event.type, String(e && e.message ? e.message : e));
    return json({ error: "Handler failed" }, 500);
  }
  return json({ received: true });
}
