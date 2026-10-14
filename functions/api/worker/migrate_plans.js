// ONE-OFF: runs migrations/2026-10-14-plans.sql. Protected by the worker key
// (functions/api/worker/_middleware.js). Delete this file after it runs.
const STATEMENTS = [
  "ALTER TABLE users ADD COLUMN plan TEXT",
  "ALTER TABLE users ADD COLUMN plan_status TEXT",
  "ALTER TABLE users ADD COLUMN plan_apps INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN plan_launch INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN launch_used INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN plan_pending TEXT",
  "ALTER TABLE users ADD COLUMN plan_period_end TEXT",
  "ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT",
  "ALTER TABLE users ADD COLUMN trial_expires_at TEXT",
];

export async function onRequestPost({ env }) {
  const out = [];
  for (const sql of STATEMENTS) {
    try {
      await env.DB.prepare(sql).run();
      out.push({ sql, ok: true });
    } catch (e) {
      // "duplicate column name" just means it already ran.
      out.push({ sql, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
