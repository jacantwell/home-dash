from collections.abc import Iterator
from datetime import datetime, timedelta
from typing import Protocol

import psycopg
from fastapi import HTTPException, Request, status
from psycopg.rows import dict_row
from pydantic import BaseModel, computed_field

COMMENT_TTL = timedelta(days=7)

_COLUMNS = "id, post_slug, color, text, created_at"


class Comment(BaseModel):
    id: int
    post_slug: str
    color: str
    text: str
    created_at: datetime

    @computed_field
    @property
    def expires_at(self) -> datetime:
        return self.created_at + COMMENT_TTL


def insert_comment(conn: psycopg.Connection, *, post_slug: str, color: str, text: str) -> Comment:
    # sweep expired rows while we're here; cheap thanks to the (post_slug, created_at) index
    conn.execute("DELETE FROM blog_comments WHERE created_at < now() - %s", (COMMENT_TTL,))
    row = conn.execute(
        f"""
        INSERT INTO blog_comments (post_slug, color, text)
        VALUES (%s, %s, %s)
        RETURNING {_COLUMNS}
        """,
        (post_slug, color, text),
    ).fetchone()
    return Comment.model_validate(row)


def list_comments(conn: psycopg.Connection, post_slug: str, limit: int) -> list[Comment]:
    rows = conn.execute(
        f"""
        SELECT {_COLUMNS} FROM blog_comments
        WHERE post_slug = %s AND created_at >= now() - %s
        ORDER BY created_at ASC, id ASC
        LIMIT %s
        """,
        (post_slug, COMMENT_TTL, limit),
    ).fetchall()
    return [Comment.model_validate(row) for row in rows]


class CommentRepo(Protocol):
    def insert(self, *, post_slug: str, color: str, text: str) -> Comment: ...

    def list(self, post_slug: str, limit: int) -> list[Comment]: ...


class PostgresCommentRepo:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert(self, **kwargs) -> Comment:
        return insert_comment(self._conn, **kwargs)

    def list(self, post_slug: str, limit: int) -> list[Comment]:
        return list_comments(self._conn, post_slug, limit)


def get_comment_repo(request: Request) -> Iterator[CommentRepo]:
    database_url: str = request.app.state.settings.database_url
    if not database_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "DATABASE_URL is not configured")
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        yield PostgresCommentRepo(conn)
