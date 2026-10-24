// POST /api/stripe-webhook
// Stripe calls this after a Checkout finishes. Public route (Stripe is not a
// signed-in user); trust comes from the Stripe-Signature check.
//
// Handles checkout.session.completed:
//   mode "payment"  a paid pack -> add its applications (once per
//                   PaymentIntent), record a referral payout if it is a
//                   referred user's first purchase, and when the buyer ticked
//                   auto-reload save their card and switch it on
//   mode "setup"    card replaced -> save the new card
// Every other event Stripe sends (the old subscription events included) is
// acknowledged and ignored.
//
// Signing secret goes in STRIPE_WEBHOOK_SECRET. Every credit is keyed on the
// PaymentIntent id so retries can never apply twice.
import { stripeRequest, verifyStripeSignature } from "./_stripe.js";
import { creditPayment, jobsFromPayment, packForJobs, saveCard } from "./dashboard/_billing.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function str(v) {
  return typeof v === "string" ? v : v && v.id ? v.id : null;
}

export async function handleCheckoutCompleted(env, session) {
  const userId = session.client_reference_id || (session.metadata && session.metadata.user_id);
  if (!userId) {
    console.log("stripe webhook: session without user", session.id);
    return;
  }
  const customerId = str(session.customer);
  const meta = session.metadata || {};

  if (session.mode === "payment") {
    if (session.payment_status !== "paid" || !session.payment_intent) return;
    const jobs = jobsFromPayment(meta.jobs, session.amount_total);
    if (!jobs) {
      console.log("stripe webhook: unrecognised payment", session.id, session.amount_total);
      return;
    }
    await creditPayment(env, {
      paymentIntentId: session.payment_intent,
      userId,
      jobs,
      amountCents: session.amount_total || 0,
      kind: "pack",
    });

    if (meta.auto_reload === "1") {
      // Buyer ticked auto-reload: keep the card they paid with and switch it on.
      const r = await stripeRequest(
        env,
        "GET",
        "/v1/payment_intents/" + encodeURIComponent(session.payment_intent),
        { expand: ["payment_method"] }
      );
      const pm = r.ok && r.data && r.data.payment_method;
      if (pm && pm.id) {
        await saveCard(env, userId, customerId, pm);
        const reload = packForJobs(meta.reload_jobs) || packForJobs(10);
        await env.DB.prepare(
          "UPDATE users SET auto_reload = 1, auto_reload_error = NULL, auto_reload_jobs = ? WHERE id = ?"
        )
          .bind(reload.jobs, userId)
          .run();
      }
    } else if (customerId) {
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
    if (customerId) {
      await stripeRequest(env, "POST", "/v1/customers/" + encodeURIComponent(customerId), {
        invoice_settings: { default_payment_method: pm.id },
      });
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
    console.log("stripe webhook:", event && event.type, String(e && e.message ? e.message : e));
    return json({ error: "Handler failed" }, 500);
  }
  return json({ received: true });
}
