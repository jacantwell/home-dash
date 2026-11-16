"""gallery albums and photos

Revision ID: 0005
Revises: 0004

Bytes live in S3 under albums/<album id>/<photo id>/; these rows are the index.
A photo is `pending` from presign until the client says its uploads landed.
`layout` is the canvas view: {"<photo id>": {"x", "y", "r", "s", "z"}}.
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE albums (
          id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
          title           text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
          clerk_user_id   text        NOT NULL,
          created_by_name text        NOT NULL DEFAULT '',
          layout          jsonb       NOT NULL DEFAULT '{}'::jsonb,
          created_at      timestamptz NOT NULL DEFAULT now(),
          updated_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX albums_updated_at_idx ON albums (updated_at DESC);

        CREATE TABLE photos (
          id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
          album_id      uuid        NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
          clerk_user_id text        NOT NULL,
          uploader_name text        NOT NULL DEFAULT '',
          status        text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'ready')),
          content_type  text        NOT NULL,
          bytes         bigint      NOT NULL CHECK (bytes > 0),
          width         integer     NOT NULL CHECK (width > 0),
          height        integer     NOT NULL CHECK (height > 0),
          created_at    timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX photos_album_idx ON photos (album_id, created_at);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE photos; DROP TABLE albums;")
