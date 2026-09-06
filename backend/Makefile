.PHONY: dev test lint fmt

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
