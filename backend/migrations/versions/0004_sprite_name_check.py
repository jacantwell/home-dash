"""enforce sprite name length and shape in the database

Revision ID: 0004
Revises: 0003

Mirrors NAME_MAX / NAME_PATTERN in api/sprites.py so a bypassed API
can't store names the UI and :name: message syntax can't handle.
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE sprites
          ADD CONSTRAINT sprites_name_check
          CHECK (char_length(name) <= 32 AND name ~ '^[a-z0-9]+(_[a-z0-9]+)*$');
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE sprites DROP CONSTRAINT sprites_name_check;")
