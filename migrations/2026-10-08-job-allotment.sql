-- Per-user job allotment. job_limit NULL = default (50). job_reset_at: only
-- jobs created after it count toward the limit (admin "Reset").
ALTER TABLE users ADD COLUMN job_limit INTEGER;
ALTER TABLE users ADD COLUMN job_reset_at TEXT;
