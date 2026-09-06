from collections.abc import Iterator
from datetime import datetime
from typing import Literal, Protocol

import psycopg
from fastapi import HTTPException, Request, status
from psycopg.rows import dict_row
from pydantic import BaseModel

Status = Literal["sent", "failed"]

_COLUMNS = "id, text, color, duration_s, status, error, sender_name, created_at"


class Message(BaseModel):
    id: int
    text: str
    color: str | None
    duration_s: int | None
    status: Status
    error: str | None
    sender_name: str
    created_at: datetime


def insert_message(
    conn: psycopg.Connection,
    *,
    clerk_user_id: str,
    sender_name: str,
    text: str,
    color: str | None,
    duration_s: int | None,
    status: Status,
    error: str | None,
) -> Message:
    row = conn.execute(
        f"""
        INSERT INTO messages (clerk_user_id, sender_name, text, color, duration_s, status, error)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING {_COLUMNS}
        """,
        (clerk_user_id, sender_name, text, color, duration_s, status, error),
    ).fetchone()
    return Message.model_validate(row)


def list_messages(conn: psycopg.Connection, limit: int) -> list[Message]:
    rows = conn.execute(
        f"SELECT {_COLUMNS} FROM messages ORDER BY created_at DESC, id DESC LIMIT %s",
        (limit,),
    ).fetchall()
    return [Message.model_validate(row) for row in rows]


class MessageRepo(Protocol):
    """What the routes need; swapped for an in-memory fake in tests."""

    def insert(
        self,
        *,
        clerk_user_id: str,
        sender_name: str,
        text: str,
        color: str | None,
        duration_s: int | None,
        status: Status,
        error: str | None,
    ) -> Message: ...

    def list(self, limit: int) -> list[Message]: ...


class PostgresRepo:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert(self, **kwargs) -> Message:
        return insert_message(self._conn, **kwargs)

    def list(self, limit: int) -> list[Message]:
        return list_messages(self._conn, limit)


def get_repo(request: Request) -> Iterator[MessageRepo]:
    """One connection per request, committed on clean exit."""
    database_url: str = request.app.state.settings.database_url
    if not database_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "DATABASE_URL is not configured")
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        yield PostgresRepo(conn)
