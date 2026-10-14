// POST /api/dashboard/billing/checkout
//   { kind: "plan", plan: "starter"|"plus" }  subscribe on Stripe Checkout
//   { kind: "topup" }                        one-time top-up pack (needs a plan)
//   { kind: "card" }                         card-only Checkout to replace the saved card
// Returns { url } to send the browser to. Credit happens in the webhook
// (functions/api/stripe-webhook.js), never here.
import {
  getBillingRow,
  launchState,
  isPaidPlan,
  planPriceCents,
  CURRENCY,
  PLANS,
  TOPUP,
} from "../_billing.js";
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
  const kind = body.kind || (body.update_card ? "card" : "");
  let params;

  if (kind === "card") {
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
  } else if (kind === "plan") {
    const plan = PLANS[body.plan];
    if (!plan) return json({ error: "Pick a plan." }, 400);
    if (isPaidPlan(row.plan) && row.plan_status !== "canceled") {
      return json({ error: "You already have a plan. Use Change plan on the Billing page." }, 400);
    }
    const launch = (await launchState(env, row)).available;
    params = {
      mode: "subscription",
      client_reference_id: data.userId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: planPriceCents(plan.id, launch),
            recurring: { interval: "month" },
            product_data: {
              name: "Applyd " + plan.name,
              description:
                plan.apps +
                " automated applications every month, filled out and submitted for you on Workday, Ashby, Greenhouse and Lever.",
            },
          },
        },
      ],
      payment_method_types: ["card"],
      custom_text: {
        submit: {
          message:
            "Renews monthly until you cancel. Your " + plan.apps + " applications are added right after payment.",
        },
      },
      success_url: origin + "/dashboard/?billing=success",
      cancel_url: origin + "/dashboard/?billing=cancel",
      metadata: { user_id: data.userId, kind: "plan", plan: plan.id, launch: launch ? "1" : "0" },
      subscription_data: {
        metadata: { user_id: data.userId, plan: plan.id, launch: launch ? "1" : "0" },
      },
    };
    if (row.stripe_customer_id) params.customer = row.stripe_customer_id;
    else if (data.email) params.customer_email = data.email;
  } else if (kind === "topup") {
    if (!isPaidPlan(row.plan)) {
      return json({ error: "Choose a plan first." }, 400);
    }
    params = {
      mode: "payment",
      client_reference_id: data.userId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: TOPUP.cents,
            product_data: {
              name: "Applyd - " + TOPUP.apps + " top-up applications",
              description:
                "Extra applications that never expire. They are used after your monthly plan applications.",
            },
          },
        },
      ],
      payment_method_types: ["card"],
      custom_text: {
        submit: { message: "Your " + TOPUP.apps + " applications are added to your account right after payment." },
      },
      success_url: origin + "/dashboard/?billing=success",
      cancel_url: origin + "/dashboard/?billing=cancel",
      metadata: { user_id: data.userId, kind: "topup", jobs: String(TOPUP.apps) },
      payment_intent_data: {
        metadata: { user_id: data.userId, kind: "topup", jobs: String(TOPUP.apps) },
      },
    };
    if (row.stripe_customer_id) params.customer = row.stripe_customer_id;
    else params.customer_creation = "always";
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
