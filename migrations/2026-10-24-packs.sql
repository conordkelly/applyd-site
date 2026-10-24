-- Application packs (10 / 25 / 50), auto-reload with a chosen pack, referral
-- codes. Plan columns from 2026-10-14-plans.sql stay in place (the trial uses
-- plan, plan_apps and trial_expires_at); the subscription ones are unused.
ALTER TABLE users ADD COLUMN auto_reload_jobs INTEGER NOT NULL DEFAULT 10;  -- pack auto-reload buys (10, 25 or 50)
ALTER TABLE users ADD COLUMN referred_by_code TEXT;                         -- referral code they signed up with
ALTER TABLE users ADD COLUMN referred_at TEXT;                              -- when they applied it (UTC)
