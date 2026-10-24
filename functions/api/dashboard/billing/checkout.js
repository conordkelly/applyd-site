// POST /api/dashboard/billing/checkout
//   { kind: "pack", jobs: 10|25|50, auto_reload: bool, reload_jobs: 10|25|50 }
//        buy a pack on Stripe Checkout; when auto_reload is true the card is
//        saved for later off-session charges of the chosen reload pack
//   { kind: "card" }
//        card-only Checkout to replace the saved card (no charge)
// Returns { url } to send the browser to. Credit happens in the webhook
// (functions/api/stripe-webhook.js), never here.
import { getBillingRow, packForJobs, CURRENCY } from "../_billing.js";
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
  let params;

  if (body.kind === "card") {
    if (!row.stripe_customer_id) {
      return json({ error: "No card on file yet." }, 400);
    }
    params = {
      mode: "setup",
      payment_method_types: ["card"],
      currency: CURRENCY,
      customer: row.stripe_customer_id,
      client_reference_id: data.userId,
      success_url: origin + "/dashboard/?billing=card",
      cancel_url: origin + "/dashboard/?billing=cancel",
      metadata: { user_id: data.userId, kind: "update_card" },
    };
  } else if (body.kind === "pack") {
    const pack = packForJobs(body.jobs);
    if (!pack) return json({ error: "Pick 10, 25 or 50 applications." }, 400);
    const auto = body.auto_reload === true;
    const reload = packForJobs(body.reload_jobs) || packForJobs(10);
    const meta = {
      user_id: data.userId,
      kind: "pack",
      jobs: String(pack.jobs),
      auto_reload: auto ? "1" : "0",
      reload_jobs: String(reload.jobs),
    };
    params = {
      mode: "payment",
      client_reference_id: data.userId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: pack.cents,
            product_data: { name: "Applyd - " + pack.jobs + " applications" },
          },
        },
      ],
      payment_method_types: ["card"],
      custom_text: {
        submit: { message: "Your " + pack.jobs + " applications are added to your account right after payment." },
      },
      success_url: origin + "/dashboard/?billing=success",
      cancel_url: origin + "/dashboard/?billing=cancel",
      metadata: meta,
      payment_intent_data: { metadata: meta },
    };
    if (auto) params.payment_intent_data.setup_future_usage = "off_session";
    if (row.stripe_customer_id) params.customer = row.stripe_customer_id;
    else {
      params.customer_creation = "always";
      if (data.email) params.customer_email = data.email;
    }
  } else {
    return json({ error: "Unknown request." }, 400);
  }

  const r = await stripeRequest(env, "POST", "/v1/checkout/sessions", params);
  if (!r.ok || !r.data || !r.data.url) {
    console.log("checkout create:", r.status, JSON.stringify(r.data && r.data.error));
    return json({ error: "Could not start checkout. Please try again." }, 502);
  }
  return json({ url: r.data.url });
}
