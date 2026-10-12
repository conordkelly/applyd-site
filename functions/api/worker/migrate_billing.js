// ONE-OFF: runs migrations/2026-10-12-billing.sql. Protected by the worker
// key (functions/api/worker/_middleware.js). Delete this file after it runs.
const STATEMENTS = [
  "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT",
  "ALTER TABLE users ADD COLUMN stripe_payment_method TEXT",
  "ALTER TABLE users ADD COLUMN card_brand TEXT",
  "ALTER TABLE users ADD COLUMN card_last4 TEXT",
  "ALTER TABLE users ADD COLUMN auto_reload INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN auto_reload_error TEXT",
  "CREATE TABLE IF NOT EXISTS stripe_payments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, jobs INTEGER NOT NULL, amount_cents INTEGER NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE INDEX IF NOT EXISTS idx_stripe_payments_user ON stripe_payments(user_id, created_at DESC)",
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
