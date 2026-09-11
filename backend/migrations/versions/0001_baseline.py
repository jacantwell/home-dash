"""baseline: messages and blog_comments

Revision ID: 0001
Revises:

These tables were created by hand in Neon before migrations existed, so this
uses IF NOT EXISTS: on an existing database it is a no-op that lets
`alembic upgrade head` take ownership; on a fresh one it builds the schema.
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
          id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          clerk_user_id text        NOT NULL,
          sender_name   text        NOT NULL DEFAULT '',
          text          text        NOT NULL,
          color         text,
          duration_s    integer     CHECK (duration_s BETWEEN 1 AND 300),
          status        text        NOT NULL CHECK (status IN ('sent', 'failed')),
          error         text,
          created_at    timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at DESC);

        -- Anonymous chat room comments; the table name predates the /blog -> /chatroom rename.
        CREATE TABLE IF NOT EXISTS blog_comments (
          id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          post_slug  text        NOT NULL,
          color      text        NOT NULL,
          text       text        NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS blog_comments_post_created_idx
          ON blog_comments (post_slug, created_at DESC);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS blog_comments; DROP TABLE IF EXISTS messages;")
