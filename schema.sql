CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  job_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  -- Set when ops Submit in ApplyD Review; user Completed tab waits ~10 min
  ops_completed_at TEXT,
  -- Set when ops ✕ / reject; hidden from user Processing + Job Queue
  rejected_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Apply addresses + inbound messages (everydaymail.ca catch-all)
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
