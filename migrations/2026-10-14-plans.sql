-- Monthly plans (Starter 15 / Plus 40 applications), launch pricing, top-ups and
-- the 48-hour free trial. job_limit / job_reset_at keep doing the counting.
ALTER TABLE users ADD COLUMN plan TEXT;                 -- 'starter' | 'plus' | 'trial' | NULL
ALTER TABLE users ADD COLUMN plan_status TEXT;          -- 'active' | 'canceling' | 'past_due' | 'canceled' | NULL
ALTER TABLE users ADD COLUMN plan_apps INTEGER NOT NULL DEFAULT 0;   -- plan's applications per period
ALTER TABLE users ADD COLUMN plan_launch INTEGER NOT NULL DEFAULT 0; -- 1 while on the locked launch price
ALTER TABLE users ADD COLUMN launch_used INTEGER NOT NULL DEFAULT 0; -- 1 once they ever took a launch spot
ALTER TABLE users ADD COLUMN plan_pending TEXT;         -- plan that starts at the next renewal
ALTER TABLE users ADD COLUMN plan_period_end TEXT;      -- next renewal (UTC)
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN trial_expires_at TEXT;     -- UTC
