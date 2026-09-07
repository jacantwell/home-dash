import re
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, field_validator

from api.auth import Claims, ClerkVerifier, bearer_token, current_user
from api.board import send_to_board
from api.comments import Comment, CommentRepo, get_comment_repo
from api.config import Settings
from api.db import Message, MessageRepo, get_repo

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


def sender_name_from(claims: Claims) -> str:
    return str(claims.get("name") or claims["sub"])


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

    # anonymous, no auth: comments vanish after COMMENT_TTL
    @app.get("/api/blog/{slug}/comments", response_model=CommentList)
    def list_comments(
        slug: Annotated[str, Path(pattern=SLUG_PATTERN, max_length=64)],
        repo: Annotated[CommentRepo, Depends(get_comment_repo)],
        limit: int = Query(100, ge=1, le=200),
    ) -> CommentList:
        return CommentList(comments=repo.list(slug, limit))

    @app.post(
        "/api/blog/{slug}/comments",
        response_model=Comment,
        status_code=status.HTTP_201_CREATED,
    )
    def create_comment(
        slug: Annotated[str, Path(pattern=SLUG_PATTERN, max_length=64)],
        body: CommentIn,
        repo: Annotated[CommentRepo, Depends(get_comment_repo)],
    ) -> Comment:
        return repo.insert(post_slug=slug, color=body.color, text=body.text)

    return app
