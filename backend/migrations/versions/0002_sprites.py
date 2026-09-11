"""sprites catalog

Revision ID: 0002
Revises: 0001

A 16x16 grid, one char per cell ("." transparent, 0-9a-f palette index).
Names are unique so they can later be typed into messages as :name:.
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE sprites (
          id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name          text        NOT NULL UNIQUE,
          clerk_user_id text        NOT NULL,
          author_name   text        NOT NULL DEFAULT '',
          w             integer     NOT NULL CHECK (w BETWEEN 1 AND 32),
          h             integer     NOT NULL CHECK (h BETWEEN 1 AND 32),
          pixels        text        NOT NULL,
          created_at    timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX sprites_created_at_idx ON sprites (created_at DESC);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE sprites;")
