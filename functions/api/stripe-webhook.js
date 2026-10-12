// POST /api/stripe-webhook
// Stripe calls this after a Checkout finishes. Public route (Stripe is not a
// signed-in user); trust comes from the Stripe-Signature check.
//
// Handles checkout.session.completed:
//   mode "payment"  paid pack -> add jobs (once per PaymentIntent), and when
//                   the buyer ticked auto-reload, save their card and switch
//                   auto-reload on
//   mode "setup"    card replaced -> save the new card
//
// Add the endpoint in Stripe Dashboard > Developers > Webhooks, event
// checkout.session.completed, and put its signing secret in
// STRIPE_WEBHOOK_SECRET.
import { stripeRequest, verifyStripeSignature } from "./_stripe.js";
import { creditPayment, PACK_JOBS } from "./dashboard/_billing.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function saveCard(env, userId, customerId, pm, autoReloadOn) {
  const card = (pm && pm.card) || {};
  await env.DB.prepare(
    "UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_payment_method = ?, card_brand = ?, card_last4 = ?, auto_reload = CASE WHEN ? THEN 1 ELSE auto_reload END, auto_reload_error = CASE WHEN ? THEN NULL ELSE auto_reload_error END WHERE id = ?"
  )
    .bind(
      customerId || null,
      pm.id,
      card.brand || null,
      card.last4 || null,
      autoReloadOn ? 1 : 0,
      autoReloadOn ? 1 : 0,
      userId
    )
    .run();
}

async function handleCheckoutCompleted(env, session) {
  const userId = session.client_reference_id || (session.metadata && session.metadata.user_id);
  if (!userId) {
    console.log("stripe webhook: session without user", session.id);
    return;
  }
  const customerId = typeof session.customer === "string" ? session.customer : null;

  if (session.mode === "payment") {
    if (session.payment_status !== "paid" || !session.payment_intent) return;
    await creditPayment(env, {
      paymentIntentId: session.payment_intent,
      userId,
      jobs: PACK_JOBS,
      amountCents: session.amount_total || 0,
      kind: "topup",
    });

    const wantsAuto = session.metadata && session.metadata.auto_reload === "1";
    if (customerId || wantsAuto) {
      let pm = null;
      if (wantsAuto) {
        const r = await stripeRequest(
          env,
          "GET",
          "/v1/payment_intents/" + encodeURIComponent(session.payment_intent),
          { expand: ["payment_method"] }
        );
        if (r.ok && r.data && r.data.payment_method && r.data.payment_method.id) {
          pm = r.data.payment_method;
        }
      }
      if (pm) {
        await saveCard(env, userId, customerId, pm, true);
      } else if (customerId) {
        await env.DB.prepare(
          "UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?"
        )
          .bind(customerId, userId)
          .run();
      }
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
    if (r.ok && r.data && r.data.payment_method && r.data.payment_method.id) {
      await saveCard(env, userId, customerId, r.data.payment_method, false);
    }
  }
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
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(env, event.data.object);
    }
  } catch (e) {
    // 500 makes Stripe retry; creditPayment is safe to run again.
    console.log("stripe webhook:", String(e && e.message ? e.message : e));
    return json({ error: "Handler failed" }, 500);
  }
  return json({ received: true });
}
