// POST /api/dashboard/billing/subscription
//   { action: "cancel" }                  stop renewing; plan runs to the period end
//   { action: "resume" }                  undo a cancel before the period ends
//   { action: "change", plan: "plus" }    switch plan from the next renewal
// Done with the Stripe API directly (no customer portal to set up).
import { getBillingRow, isPaidPlan, planPriceCents, CURRENCY, PLANS } from "../_billing.js";
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
    return json({ error: "Invalid request body" }, 400);
  }
  const row = await getBillingRow(env, data.userId);
  if (!row) return json({ error: "Billing is still being set up. Please try again soon." }, 503);
  if (!isPaidPlan(row.plan) || !row.stripe_subscription_id) {
    return json({ error: "You do not have a plan." }, 400);
  }
  const subPath = "/v1/subscriptions/" + encodeURIComponent(row.stripe_subscription_id);

  if (body.action === "cancel" || body.action === "resume") {
    const cancel = body.action === "cancel";
    const r = await stripeRequest(env, "POST", subPath, { cancel_at_period_end: cancel ? "true" : "false" });
    if (!r.ok) {
      console.log("subscription " + body.action + ":", r.status, JSON.stringify(r.data && r.data.error));
      return json({ error: "Could not update your subscription. Please try again." }, 502);
    }
    // Keep past_due as is; otherwise reflect the new state right away.
    if (row.plan_status !== "past_due") {
      await env.DB.prepare("UPDATE users SET plan_status = ? WHERE id = ?")
        .bind(cancel ? "canceling" : "active", data.userId)
        .run();
    }
    return json({ ok: true });
  }

  if (body.action === "change") {
    const target = PLANS[body.plan];
    if (!target) return json({ error: "Pick a plan." }, 400);
    if (row.plan_status === "canceling") {
      return json({ error: "Resume your subscription before changing plans." }, 400);
    }
    // Subscription items need an existing Stripe product, so make one.
    const prod = await stripeRequest(env, "POST", "/v1/products", { name: "Applyd " + target.name });
    if (!prod.ok || !prod.data || !prod.data.id) {
      return json({ error: "Could not change your plan. Please try again." }, 502);
    }
    const got = await stripeRequest(env, "GET", subPath, {});
    const item = got.ok && got.data && got.data.items && got.data.items.data && got.data.items.data[0];
    if (!item) return json({ error: "Could not change your plan. Please try again." }, 502);
    const r = await stripeRequest(env, "POST", subPath, {
      items: [
        {
          id: item.id,
          price_data: {
            currency: CURRENCY,
            product: prod.data.id,
            unit_amount: planPriceCents(target.id, !!row.plan_launch),
            recurring: { interval: "month" },
          },
        },
      ],
      proration_behavior: "none",
      metadata: { plan: target.id },
    });
    if (!r.ok) {
      console.log("subscription change:", r.status, JSON.stringify(r.data && r.data.error));
      return json({ error: "Could not change your plan. Please try again." }, 502);
    }
    await env.DB.prepare("UPDATE users SET plan_pending = ? WHERE id = ?")
      .bind(target.id === row.plan ? null : target.id, data.userId)
      .run();
    return json({ ok: true });
  }

  return json({ error: "Unknown request." }, 400);
}
