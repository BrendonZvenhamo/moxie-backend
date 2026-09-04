CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform platform_type NOT NULL,
  external_event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_webhook_event_identity UNIQUE (platform, external_event_id),
  CONSTRAINT webhook_events_status_chk CHECK (status IN ('pending', 'processing', 'processed'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_claim
  ON webhook_events (status, locked_until, created_at);

CREATE TABLE IF NOT EXISTS outbox_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dedupe_key TEXT NOT NULL UNIQUE,
  platform platform_type NOT NULL,
  recipient_external_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT outbox_status_chk CHECK (status IN ('pending', 'processing', 'delivered'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_claim
  ON outbox_messages (status, next_attempt_at, locked_until, created_at);

CREATE TABLE IF NOT EXISTS match_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  text_content TEXT,
  media_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_match_messages_match_created
  ON match_messages (match_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated
  ON rate_limits (updated_at);

-- The legacy schema did not enforce one active match per pair. Refuse the
-- upgrade if existing live data violates the new invariant instead of silently
-- deleting or rewriting production matches.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM matches
    WHERE ended_at IS NULL
    GROUP BY LEAST(user_1_id, user_2_id), GREATEST(user_1_id, user_2_id)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Moxie migration blocked: duplicate active match pairs exist. Resolve them before applying 001_resilience.sql.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_match_pair
  ON matches (LEAST(user_1_id, user_2_id), GREATEST(user_1_id, user_2_id))
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matches_cleanup
  ON matches (ended_at, last_activity_at, started_at);
