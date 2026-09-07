-- Reference only: this table already exists in Neon (project small-haze-95966581, db neondb).
-- No migrations are run by the service.
CREATE TABLE IF NOT EXISTS messages (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clerk_user_id text        NOT NULL,
  sender_name   text        NOT NULL DEFAULT '',
  text          text        NOT NULL,
  color         text,
  duration_s    integer     CHECK (duration_s BETWEEN 1 AND 300),  -- null: board default; the api caps at 60
  status        text        NOT NULL CHECK (status IN ('sent', 'failed')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at DESC);

-- Anonymous chat room comments; the table name predates the /blog -> /chatroom rename.
-- Rows older than 7 days are hidden on read and swept on the next insert, so nothing needs a cron.
CREATE TABLE IF NOT EXISTS blog_comments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_slug  text        NOT NULL,
  color      text        NOT NULL,
  text       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blog_comments_post_created_idx ON blog_comments (post_slug, created_at DESC);
