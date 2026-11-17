"""wipe 2D canvas layouts

Revision ID: 0006
Revises: 0005

The canvas is 3D now: `layout` is {"<photo id>": {"x", "y", "z", "yaw", "r", "s"}}.
Old 2D layouts can't be mapped across, so every album starts fresh.
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE albums SET layout = '{}'::jsonb")


def downgrade() -> None:
    op.execute("UPDATE albums SET layout = '{}'::jsonb")
