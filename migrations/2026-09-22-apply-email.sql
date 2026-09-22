-- Apply inboxes: address index + stored messages (Cloudflare catch-all).
-- Run against D1 database applyd-jobs (Production + Preview).

CREATE TABLE IF NOT EXISTS apply_email_addresses (
  email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS apply_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  to_address TEXT NOT NULL,
  from_address TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at TEXT NOT NULL,
  forwarded_at TEXT,
  forward_status TEXT,
  raw_size INTEGER
);

CREATE INDEX IF NOT EXISTS idx_apply_messages_user_received
  ON apply_messages(user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_apply_email_addresses_user
  ON apply_email_addresses(user_id);
