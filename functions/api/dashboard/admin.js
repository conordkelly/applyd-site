import { accountSummary, REFERRAL_CODES } from "./_billing.js";

export async function onRequestGet(context) {
  const { env, data } = context;

  if (data.userId !== env.ADMIN_USER_ID) {
    return json({ error: "Not authorized" }, 403);
  }

  const { results: users } = await env.DB.prepare(
    "SELECT id, email, created_at FROM users ORDER BY created_at DESC"
  ).all();

  // rejected_at/rejected_reason: without these, a job pushed to the user's
  // Unable to Process tab still shows "processing" here forever — reject
  // only ever sets rejected_at, never changes the status column itself.
  let jobs;
  try {
    ({ results: jobs } = await env.DB.prepare(
      "SELECT id, user_id, job_url, status, created_at, completed_at, rejected_at, rejected_reason FROM jobs ORDER BY created_at DESC"
    ).all());
  } catch (e) {
    // Pre-migration fallback (rejected_reason column not yet added)
    ({ results: jobs } = await env.DB.prepare(
      "SELECT id, user_id, job_url, status, created_at, completed_at, rejected_at FROM jobs ORDER BY created_at DESC"
    ).all());
  }

  const byUser = await Promise.all(users.map(async (u) => ({
    ...u,
    jobs: jobs.filter((j) => j.user_id === u.id),
    usage: await accountSummary(env, u.id),
  })));

  // Free trials running (zero before the plans migration has run).
  const stats = { trials_running: 0 };
  try {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE plan = 'trial' AND trial_expires_at > datetime('now')"
    ).first();
    stats.trials_running = (r && r.n) || 0;
  } catch (e) {
    // plan columns not added yet
  }

  // Referrals: which user used which code, when, and when they first bought.
  const referrals = {
    codes: Object.keys(REFERRAL_CODES).map((code) => ({
      code,
      owner: REFERRAL_CODES[code].owner,
      signups: 0,
      purchases: 0,
    })),
    users: [],
  };
  try {
    const first = "SELECT %COL% FROM stripe_payments p WHERE p.user_id = u.id ORDER BY p.created_at ASC, p.rowid ASC LIMIT 1";
    const { results: referred } = await env.DB.prepare(
      "SELECT u.id, u.email, u.referred_by_code AS code, u.referred_at, (" +
        first.replace("%COL%", "p.created_at") + ") AS first_purchase_at, (" +
        first.replace("%COL%", "p.amount_cents") + ") AS first_purchase_cents, (" +
        first.replace("%COL%", "p.jobs") + ") AS first_purchase_jobs FROM users u WHERE u.referred_by_code IS NOT NULL ORDER BY u.referred_at DESC, u.created_at DESC"
    ).all();
    referrals.users = (referred || []).map((r) => ({
      user_id: r.id,
      email: r.email,
      code: r.code,
      owner: REFERRAL_CODES[r.code] ? REFERRAL_CODES[r.code].owner : "",
      referred_at: r.referred_at,
      first_purchase_at: r.first_purchase_at,
      first_purchase_cents: r.first_purchase_cents,
      first_purchase_jobs: r.first_purchase_jobs,
    }));
    referrals.users.forEach((r) => {
      const c = referrals.codes.find((x) => x.code === r.code);
      if (c) {
        c.signups += 1;
        if (r.first_purchase_at) c.purchases += 1;
      }
    });
  } catch (e) {
    // referral columns not added yet
  }

  return json({ users: byUser, stats, referrals });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
