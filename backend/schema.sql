-- Reference only: this table already exists in Neon (project small-haze-95966581, db neondb).
-- No migrations are run by the service.
CREATE TABLE IF NOT EXISTS messages (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clerk_user_id text        NOT NULL,
  sender_name   text        NOT NULL DEFAULT '',
  text          text        NOT NULL,
  color         text,
  status        text        NOT NULL CHECK (status IN ('sent', 'failed')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at DESC);
