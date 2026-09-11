.PHONY: dev test lint fmt migrate migrate-down migration

dev:
	uv run uvicorn main:app --reload --port 8000

test:
	uv run pytest

lint:
	uv run ruff check .
	uv run ruff format --check .

fmt:
	uv run ruff format .
	uv run ruff check --fix .

# Applies every pending revision to DATABASE_URL (env, ../.env.local, .env).
migrate:
	uv run alembic upgrade head

migrate-down:
	uv run alembic downgrade -1

# make migration m="add foo"  -> migrations/versions/<rev>_add_foo.py to fill in with SQL
migration:
	uv run alembic revision -m "$(m)"
