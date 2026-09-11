import re
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field, field_validator, model_validator

from api.auth import Claims, ClerkVerifier, bearer_token, current_user
from api.board import EtchResult, etch_clear, etch_move, etch_state, send_to_board
from api.comments import Comment, CommentRepo, get_comment_repo
from api.config import Settings
from api.db import Message, MessageRepo, get_repo
from api.sprites import (
    NAME_MAX,
    NAME_PATTERN,
    PIXELS_PATTERN,
    SPRITE_CELLS,
    SPRITE_SIZE,
    Sprite,
    SpriteNameTaken,
    SpriteRepo,
    get_sprite_repo,
)

TEXT_MAX = 200
DURATION_MAX_S = 60
COMMENT_MAX = 200
COMMENT_MAX_LINES = 5
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class MessageIn(BaseModel):
    text: str
    color: str | None = None
    duration_s: int | None = Field(default=None, ge=1, le=DURATION_MAX_S)

    @field_validator("text")
    @classmethod
    def _normalise_text(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("text must not be empty")
        if len(value) > TEXT_MAX:
            raise ValueError(f"text must be at most {TEXT_MAX} characters")
        return value

    @field_validator("color")
    @classmethod
    def _validate_color(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        return _normalise_color(value)


class MessageList(BaseModel):
    messages: list[Message] = Field(default_factory=list)


class EtchMove(BaseModel):
    dx: int = Field(default=0, ge=-32, le=32)
    dy: int = Field(default=0, ge=-32, le=32)

    @model_validator(mode="after")
    def _reject_noop(self) -> "EtchMove":
        if self.dx == 0 and self.dy == 0:
            raise ValueError("dx/dy can't both be zero")
        return self


def _etch_or_raise(result: EtchResult) -> dict:
    """Return the Pi's JSON, or surface its failure (502 when the Pi can't be reached)."""
    if result.ok:
        return result.body
    if result.status_code is None:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, result.error or "ledboard unreachable")
    raise HTTPException(result.status_code, result.error)


def require_frontend_origin(request: Request) -> None:
    """Etch is anonymous, but only the home-dash frontend may call it.

    Browsers attest this with Origin/Referer, which must match an entry in
    CLERK_AUTHORIZED_PARTIES; anything else (curl, hotlinks) gets a 403.
    Empty means don't check, like local dev.
    """
    settings: Settings = request.app.state.settings
    allowed = {origin.rstrip("/") for origin in settings.authorized_parties}
    if not allowed:
        return
    for header in (request.headers.get("origin"), request.headers.get("referer")):
        if not header:
            continue
        parts = urlsplit(header)
        origin = (
            f"{parts.scheme}://{parts.netloc}".rstrip("/") if parts.netloc else header.rstrip("/")
        )
        if origin in allowed:
            return
    raise HTTPException(
        status.HTTP_403_FORBIDDEN, "etch is only available from the home-dash frontend"
    )


def _forwarded_origin_headers(request: Request) -> dict[str, str]:
    """Browser Origin/Referer, passed to the Pi so it can apply the same check."""
    return {name: value for name in ("origin", "referer") if (value := request.headers.get(name))}


def _normalise_color(value: str) -> str:
    if not _HEX_COLOR.match(value):
        raise ValueError("color must be #rrggbb")
    return value.lower()


class CommentIn(BaseModel):
    text: str
    color: str

    @field_validator("text")
    @classmethod
    def _normalise_text(cls, value: str) -> str:
        # keep line breaks (it's a note), squash everything else
        lines = [" ".join(line.split()) for line in value.splitlines()]
        lines = [line for line in lines if line]
        if not lines:
            raise ValueError("text must not be empty")
        if len(lines) > COMMENT_MAX_LINES:
            raise ValueError(f"text must be at most {COMMENT_MAX_LINES} lines")
        text = "\n".join(lines)
        if len(text) > COMMENT_MAX:
            raise ValueError(f"text must be at most {COMMENT_MAX} characters")
        return text

    _validate_color = field_validator("color")(_normalise_color)


class CommentList(BaseModel):
    comments: list[Comment] = Field(default_factory=list)


class SpriteIn(BaseModel):
    name: str = Field(pattern=NAME_PATTERN, max_length=NAME_MAX)
    pixels: str

    @field_validator("pixels")
    @classmethod
    def _validate_pixels(cls, value: str) -> str:
        if len(value) != SPRITE_CELLS:
            raise ValueError(f"pixels must be exactly {SPRITE_CELLS} cells")
        if not PIXELS_PATTERN.match(value):
            raise ValueError("pixels must be '.' or a hex digit per cell")
        if value.count(".") == SPRITE_CELLS:
            raise ValueError("sprite must not be empty")
        return value


class SpriteList(BaseModel):
    sprites: list[Sprite] = Field(default_factory=list)


def sender_name_from(claims: Claims) -> str:
    # never fall back to `sub`: the Clerk user id is not a display name
    return str(claims.get("name") or "")


def create_app(settings: Settings, verifier: ClerkVerifier | None = None) -> FastAPI:
    app = FastAPI(title="home-dash-api", version="0.1.0")
    app.state.settings = settings
    if verifier is None and settings.issuer:
        verifier = ClerkVerifier(settings.issuer, settings.authorized_parties)
    # None -> auth routes answer 503 instead of the whole service failing to import
    app.state.verifier = verifier

    @app.get("/api/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    # `claims` is resolved before `repo`, so a 401 never opens a DB connection
    @app.get("/api/messages", response_model=MessageList)
    def list_messages(
        claims: Annotated[Claims, Depends(current_user)],
        repo: Annotated[MessageRepo, Depends(get_repo)],
        limit: int = Query(20, ge=1, le=100),
    ) -> MessageList:
        return MessageList(messages=repo.list(limit))

    @app.post("/api/messages", response_model=Message, status_code=status.HTTP_202_ACCEPTED)
    def create_message(
        body: MessageIn,
        claims: Annotated[Claims, Depends(current_user)],
        token: Annotated[str, Depends(bearer_token)],
        repo: Annotated[MessageRepo, Depends(get_repo)],
    ) -> Message:
        result = send_to_board(settings, token, body.text, body.color, body.duration_s)
        message = repo.insert(
            clerk_user_id=claims["sub"],
            sender_name=sender_name_from(claims),
            text=body.text,
            color=body.color,
            duration_s=body.duration_s,
            status="sent" if result.ok else "failed",
            error=result.error,
        )
        if result.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "ledboard is rate limiting")
        return message

    # etch-a-sketch: anonymous, frontend-only. The Pi owns the sketch buffer,
    # this just forwards the browser's Origin/Referer with the call.
    @app.get("/api/etch")
    def get_etch(
        request: Request,
        _origin: None = Depends(require_frontend_origin),
    ) -> dict:
        settings: Settings = app.state.settings
        return _etch_or_raise(etch_state(settings, headers=_forwarded_origin_headers(request)))

    @app.post("/api/etch/move")
    def post_etch_move(
        body: EtchMove,
        request: Request,
        _origin: None = Depends(require_frontend_origin),
    ) -> dict:
        settings: Settings = app.state.settings
        return _etch_or_raise(
            etch_move(settings, body.dx, body.dy, headers=_forwarded_origin_headers(request))
        )

    @app.post("/api/etch/clear")
    def post_etch_clear(
        request: Request,
        _origin: None = Depends(require_frontend_origin),
    ) -> dict:
        settings: Settings = app.state.settings
        return _etch_or_raise(etch_clear(settings, headers=_forwarded_origin_headers(request)))

    # anonymous, no auth: comments vanish after COMMENT_TTL
    @app.get("/api/chatroom/{slug}/comments", response_model=CommentList)
    def list_comments(
        slug: Annotated[str, Path(pattern=SLUG_PATTERN, max_length=64)],
        repo: Annotated[CommentRepo, Depends(get_comment_repo)],
        limit: int = Query(100, ge=1, le=200),
    ) -> CommentList:
        return CommentList(comments=repo.list(slug, limit))

    @app.post(
        "/api/chatroom/{slug}/comments",
        response_model=Comment,
        status_code=status.HTTP_201_CREATED,
    )
    def create_comment(
        slug: Annotated[str, Path(pattern=SLUG_PATTERN, max_length=64)],
        body: CommentIn,
        repo: Annotated[CommentRepo, Depends(get_comment_repo)],
    ) -> Comment:
        return repo.insert(post_slug=slug, color=body.color, text=body.text)

    # sprites: anyone can browse the catalog, saving needs a login
    @app.get("/api/sprites", response_model=SpriteList)
    def list_sprites(
        repo: Annotated[SpriteRepo, Depends(get_sprite_repo)],
        limit: int = Query(200, ge=1, le=500),
    ) -> SpriteList:
        return SpriteList(sprites=repo.list(limit))

    @app.post("/api/sprites", response_model=Sprite, status_code=status.HTTP_201_CREATED)
    def create_sprite(
        body: SpriteIn,
        claims: Annotated[Claims, Depends(current_user)],
        repo: Annotated[SpriteRepo, Depends(get_sprite_repo)],
    ) -> Sprite:
        try:
            return repo.insert(
                name=body.name,
                clerk_user_id=claims["sub"],
                author_name=sender_name_from(claims),
                w=SPRITE_SIZE,
                h=SPRITE_SIZE,
                pixels=body.pixels,
            )
        except SpriteNameTaken:
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"a sprite called '{body.name}' already exists"
            ) from None

    return app
