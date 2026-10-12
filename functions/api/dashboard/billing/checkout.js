// POST /api/dashboard/billing/checkout
//   { auto_reload: true|false }   buy one pack on Stripe Checkout; when
//                                 auto_reload is true the card is saved for
//                                 later off-session charges
//   { update_card: true }         Stripe Checkout in setup mode to replace
//                                 the saved card (no charge)
// Returns { url } to send the browser to. Credit happens in the webhook
// (functions/api/stripe-webhook.js), never here.
import { getBillingRow, PACK_JOBS, PACK_PRICE_CENTS, CURRENCY } from "../_billing.js";
import { stripeConfigured, stripeRequest } from "../../_stripe.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;

  if (!stripeConfigured(env)) {
    return json({ error: "Payments are not set up yet. Please try again soon." }, 503);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Billing columns missing means the migration has not run: refuse rather
  // than take a payment we could not record.
  const row = await getBillingRow(env, data.userId);
  if (!row) {
    return json({ error: "Billing is still being set up. Please try again soon." }, 503);
  }

  const origin = new URL(request.url).origin;
  const customerParams = row.stripe_customer_id
    ? { customer: row.stripe_customer_id }
    : data.email
    ? { customer_creation: "always", customer_email: data.email }
    : { customer_creation: "always" };

  let params;
  if (body.update_card) {
    if (!row.stripe_customer_id) {
      return json({ error: "No card on file yet. Top up first." }, 400);
    }
    params = {
      mode: "setup",
      currency: CURRENCY,
      customer: row.stripe_customer_id,
      client_reference_id: data.userId,
      success_url: origin + "/dashboard/?billing=card",
      cancel_url: origin + "/dashboard/?billing=cancel",
      metadata: { user_id: data.userId, kind: "update_card" },
    };
  } else {
    const auto = body.auto_reload === true;
    params = {
      mode: "payment",
      client_reference_id: data.userId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: PACK_PRICE_CENTS,
            product_data: { name: PACK_JOBS + " automated applications" },
          },
        },
      ],
      success_url: origin + "/dashboard/?billing=success",
      cancel_url: origin + "/dashboard/?billing=cancel",
      metadata: { user_id: data.userId, auto_reload: auto ? "1" : "0" },
      payment_intent_data: {
        metadata: { user_id: data.userId, kind: "topup" },
      },
    };
    Object.assign(params, customerParams);
    if (auto) params.payment_intent_data.setup_future_usage = "off_session";
  }

  const r = await stripeRequest(env, "POST", "/v1/checkout/sessions", params);
  if (!r.ok || !r.data || !r.data.url) {
    console.log("checkout create:", r.status, JSON.stringify(r.data && r.data.error));
    return json({ error: "Could not start checkout. Please try again." }, 502);
  }
  return json({ url: r.data.url });
}
