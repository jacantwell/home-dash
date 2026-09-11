import re
from collections.abc import Iterator
from datetime import datetime
from typing import Protocol

import psycopg
from fastapi import HTTPException, Request, status
from psycopg.rows import dict_row
from pydantic import BaseModel

# One char per cell, row-major: "." is transparent, 0-9a-f indexes the 16-colour palette.
SPRITE_SIZE = 16
SPRITE_CELLS = SPRITE_SIZE * SPRITE_SIZE
PIXELS_PATTERN = re.compile(r"^[.0-9a-f]+$")
NAME_PATTERN = r"^[a-z0-9]+(?:_[a-z0-9]+)*$"
NAME_MAX = 32

# Classic 16-colour Paint palette, shared with the frontend.
PALETTE = [
    "#000000",
    "#808080",
    "#800000",
    "#808000",
    "#008000",
    "#008080",
    "#000080",
    "#800080",
    "#ffffff",
    "#c0c0c0",
    "#ff0000",
    "#ffff00",
    "#00ff00",
    "#00ffff",
    "#0000ff",
    "#ff00ff",
]

_COLUMNS = "id, name, author_name, w, h, pixels, created_at"


class Sprite(BaseModel):
    id: int
    name: str
    author_name: str
    w: int
    h: int
    pixels: str
    created_at: datetime


class SpriteNameTaken(Exception):
    pass


def insert_sprite(
    conn: psycopg.Connection,
    *,
    name: str,
    clerk_user_id: str,
    author_name: str,
    w: int,
    h: int,
    pixels: str,
) -> Sprite:
    try:
        row = conn.execute(
            f"""
            INSERT INTO sprites (name, clerk_user_id, author_name, w, h, pixels)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING {_COLUMNS}
            """,
            (name, clerk_user_id, author_name, w, h, pixels),
        ).fetchone()
    except psycopg.errors.UniqueViolation as exc:
        raise SpriteNameTaken(name) from exc
    return Sprite.model_validate(row)


def list_sprites(conn: psycopg.Connection, limit: int) -> list[Sprite]:
    rows = conn.execute(
        f"SELECT {_COLUMNS} FROM sprites ORDER BY created_at DESC, id DESC LIMIT %s",
        (limit,),
    ).fetchall()
    return [Sprite.model_validate(row) for row in rows]


class SpriteRepo(Protocol):
    def insert(
        self,
        *,
        name: str,
        clerk_user_id: str,
        author_name: str,
        w: int,
        h: int,
        pixels: str,
    ) -> Sprite: ...

    def list(self, limit: int) -> list[Sprite]: ...


class PostgresSpriteRepo:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert(self, **kwargs) -> Sprite:
        return insert_sprite(self._conn, **kwargs)

    def list(self, limit: int) -> list[Sprite]:
        return list_sprites(self._conn, limit)


def get_sprite_repo(request: Request) -> Iterator[SpriteRepo]:
    database_url: str = request.app.state.settings.database_url
    if not database_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "DATABASE_URL is not configured")
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        yield PostgresSpriteRepo(conn)
