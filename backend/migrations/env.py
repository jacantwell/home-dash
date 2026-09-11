"""Alembic entrypoint. Reads DATABASE_URL the same way the service does (env, then
../.env.local, then .env) so `make migrate` hits whatever the app would."""

from alembic import context
from sqlalchemy import create_engine, pool

from api.config import Settings


def database_url() -> str:
    url = Settings().database_url
    if not url:
        raise SystemExit("DATABASE_URL is not set")
    # Neon hands out postgresql://; SQLAlchemy needs the driver spelled out to use psycopg 3.
    for scheme in ("postgresql://", "postgres://"):
        if url.startswith(scheme):
            return "postgresql+psycopg://" + url.removeprefix(scheme)
    return url


def run_migrations_offline() -> None:
    context.configure(url=database_url(), literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
