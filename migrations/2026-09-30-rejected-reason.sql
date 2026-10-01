-- Run once on D1 database applyd-jobs (dashboard Console or wrangler d1 execute).
-- Safe to run if columns already exist? SQLite errors on duplicate — run each once.

ALTER TABLE jobs ADD COLUMN rejected_reason TEXT;
