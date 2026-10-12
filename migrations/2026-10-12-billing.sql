-- Pay-as-you-go billing (Stripe). 25 jobs for $2.99 CAD, optional auto-reload.
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_payment_method TEXT;
ALTER TABLE users ADD COLUMN card_brand TEXT;
ALTER TABLE users ADD COLUMN card_last4 TEXT;
ALTER TABLE users ADD COLUMN auto_reload INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN auto_reload_error TEXT;

-- One row per paid pack. id is the Stripe PaymentIntent id, so a webhook
-- retry or a repeated auto-reload can never credit the same payment twice.
CREATE TABLE IF NOT EXISTS stripe_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  jobs INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_user ON stripe_payments(user_id, created_at DESC);
