from datetime import UTC, datetime, timedelta

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
