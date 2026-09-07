from datetime import UTC, datetime, timedelta

from api.comments import COMMENT_TTL, Comment
from api.db import Message, Status


class InMemoryRepo:
    """Newest-first like the SQL; each insert lands 1s after the last."""

    def __init__(self) -> None:
        self.rows: list[Message] = []
        self._clock = datetime(2026, 1, 1, tzinfo=UTC)

    def insert(
        self,
        *,
        clerk_user_id: str,
        sender_name: str,
        text: str,
        color: str | None,
        duration_s: int | None = None,
        status: Status,
        error: str | None,
    ) -> Message:
        self._clock += timedelta(seconds=1)
        message = Message(
            id=len(self.rows) + 1,
            text=text,
            color=color,
            duration_s=duration_s,
            status=status,
            error=error,
            sender_name=sender_name,
            created_at=self._clock,
        )
        self.rows.append(message)
        return message

    def list(self, limit: int) -> list[Message]:
        return sorted(self.rows, key=lambda m: (m.created_at, m.id), reverse=True)[:limit]


class InMemoryCommentRepo:
    """Oldest-first like the SQL; `now` is injectable so expiry can be tested."""

    def __init__(self, now: datetime | None = None) -> None:
        self.rows: list[Comment] = []
        self.now = now or datetime(2026, 1, 8, tzinfo=UTC)
        self._clock = self.now

    def insert(self, *, post_slug: str, color: str, text: str) -> Comment:
        self.rows = [c for c in self.rows if c.created_at >= self.now - COMMENT_TTL]
        self._clock += timedelta(seconds=1)
        comment = Comment(
            id=len(self.rows) + 1,
            post_slug=post_slug,
            color=color,
            text=text,
            created_at=self._clock,
        )
        self.rows.append(comment)
        return comment

    def list(self, post_slug: str, limit: int) -> list[Comment]:
        live = [
            c
            for c in self.rows
            if c.post_slug == post_slug and c.created_at >= self.now - COMMENT_TTL
        ]
        return sorted(live, key=lambda c: (c.created_at, c.id))[:limit]
