-- Fields referenced by the application service/model layer but missing from the legacy schema.
ALTER TABLE users ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pref_age_min INTEGER NOT NULL DEFAULT 18;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pref_age_max INTEGER NOT NULL DEFAULT 99;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mood TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reward_at TIMESTAMPTZ;
