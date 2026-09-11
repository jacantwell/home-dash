"""scrub clerk user ids stored as display names

Revision ID: 0003
Revises: 0002

Tokens without a `name` claim used to fall back to `sub`, leaking the
Clerk user id into author/sender names. Blank them; the UI shows "someone".
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE sprites SET author_name = '' WHERE author_name LIKE 'user\\_%';")
    op.execute("UPDATE messages SET sender_name = '' WHERE sender_name LIKE 'user\\_%';")


def downgrade() -> None:
    pass
