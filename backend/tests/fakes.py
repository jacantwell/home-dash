from datetime import UTC, date, datetime, timedelta
from datetime import time as clock
from typing import Any
from uuid import UUID, uuid4

from api.calendar import CalendarError, CalendarEvent, google_times
from api.comments import COMMENT_TTL, Comment
from api.db import Message, Status
from api.photos import AlbumRow, PhotoRow, Placement, PresignedPost, StorageError
from api.sprites import Sprite, SpriteNameTaken


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


class InMemorySpriteRepo:
    """Newest-first like the SQL; unique names raise like the DB constraint would."""

    def __init__(self) -> None:
        self.rows: list[Sprite] = []
        self._clock = datetime(2026, 1, 1, tzinfo=UTC)

    def insert(
        self,
        *,
        name: str,
        clerk_user_id: str,
        author_name: str,
        w: int,
        h: int,
        pixels: str,
    ) -> Sprite:
        if any(s.name == name for s in self.rows):
            raise SpriteNameTaken(name)
        self._clock += timedelta(seconds=1)
        sprite = Sprite(
            name=name,
            author_name=author_name,
            w=w,
            h=h,
            pixels=pixels,
            created_at=self._clock,
        )
        self.rows.append(sprite)
        return sprite

    def list(self, limit: int) -> list[Sprite]:
        return sorted(self.rows, key=lambda s: s.created_at, reverse=True)[:limit]


class InMemoryCalendar:
    """Records create() kwargs; set `error` to make every call raise CalendarError."""

    def __init__(self, events: list[CalendarEvent] | None = None) -> None:
        self.events: list[CalendarEvent] = list(events or [])
        self.created: list[dict[str, Any]] = []
        self.limits: list[int] = []
        self.error: str | None = None

    def upcoming(self, limit: int) -> list[CalendarEvent]:
        self.limits.append(limit)
        if self.error:
            raise CalendarError(self.error)
        return self.events[:limit]

    def create(
        self,
        *,
        title: str,
        day: date,
        start: clock | None,
        end: clock | None,
        location: str | None,
        added_by: str,
    ) -> CalendarEvent:
        kwargs = {
            "title": title,
            "day": day,
            "start": start,
            "end": end,
            "location": location,
            "added_by": added_by,
        }
        self.created.append(kwargs)
        if self.error:
            raise CalendarError(self.error)
        begins, ends = google_times(day, start, end)
        key = "date" if start is None else "dateTime"
        event = CalendarEvent(
            id=f"evt{len(self.created)}",
            title=title,
            start=begins[key],
            end=ends[key],
            all_day=start is None,
            location=location,
            link=None,
        )
        self.events.append(event)
        return event


class InMemoryPhotoRepo:
    """Like the SQL: lists/counts/cover only see ready photos, album deletes cascade."""

    def __init__(self) -> None:
        self.albums: dict[UUID, AlbumRow] = {}
        self.photos: dict[UUID, PhotoRow] = {}
        self._clock = datetime(2026, 1, 1, tzinfo=UTC)

    def _tick(self) -> datetime:
        self._clock += timedelta(seconds=1)
        return self._clock

    def _with_counts(self, album: AlbumRow) -> AlbumRow:
        ready = self.list_photos(album.id)
        cover = ready[0].id if ready else None
        return album.model_copy(update={"photo_count": len(ready), "cover_photo_id": cover})

    def list_albums(self, limit: int) -> list[AlbumRow]:
        albums = sorted(self.albums.values(), key=lambda a: a.updated_at, reverse=True)
        return [self._with_counts(a) for a in albums[:limit]]

    def get_album(self, album_id: UUID) -> AlbumRow | None:
        album = self.albums.get(album_id)
        return self._with_counts(album) if album else None

    def create_album(self, *, title: str, clerk_user_id: str, created_by_name: str) -> AlbumRow:
        now = self._tick()
        album = AlbumRow(
            id=uuid4(),
            title=title,
            clerk_user_id=clerk_user_id,
            created_by_name=created_by_name,
            layout={},
            photo_count=0,
            cover_photo_id=None,
            created_at=now,
            updated_at=now,
        )
        self.albums[album.id] = album
        return album

    def delete_album(self, album_id: UUID) -> None:
        self.albums.pop(album_id, None)
        self.photos = {k: p for k, p in self.photos.items() if p.album_id != album_id}

    def save_layout(self, album_id: UUID, layout: dict[str, Placement]) -> None:
        album = self.albums[album_id]
        update = {"layout": dict(layout), "updated_at": self._tick()}
        self.albums[album_id] = album.model_copy(update=update)

    def list_photos(self, album_id: UUID) -> list[PhotoRow]:
        ready = [p for p in self.photos.values() if p.album_id == album_id and p.status == "ready"]
        return sorted(ready, key=lambda p: (p.created_at, p.id))

    def get_photo(self, photo_id: UUID) -> PhotoRow | None:
        return self.photos.get(photo_id)

    def create_photo(self, **kwargs: Any) -> PhotoRow:
        photo = PhotoRow(id=uuid4(), status="pending", created_at=self._tick(), **kwargs)
        self.photos[photo.id] = photo
        return photo

    def mark_ready(self, photo_id: UUID) -> PhotoRow | None:
        if photo_id not in self.photos:
            return None
        photo = self.photos[photo_id].model_copy(update={"status": "ready"})
        self.photos[photo_id] = photo
        album = self.albums[photo.album_id]
        self.albums[album.id] = album.model_copy(update={"updated_at": self._tick()})
        return photo

    def delete_photo(self, photo: PhotoRow) -> None:
        self.photos.pop(photo.id, None)
        album = self.albums[photo.album_id]
        layout = {k: v for k, v in album.layout.items() if k != str(photo.id)}
        self.albums[album.id] = album.model_copy(update={"layout": layout})


class FakePhotoStore:
    """Records presigns/exists checks/deletes; set `error` to make S3-backed calls raise."""

    def __init__(self) -> None:
        self.presigned: list[tuple[str, str, int]] = []
        self.existing: set[str] = set()
        self.checked: list[str] = []
        self.deleted: list[str] = []
        self.error: str | None = None

    def presign_upload(self, key: str, content_type: str, max_bytes: int) -> PresignedPost:
        self.presigned.append((key, content_type, max_bytes))
        return PresignedPost(url="https://bucket.test/", fields={"key": key})

    def exists(self, key: str) -> bool:
        self.checked.append(key)
        if self.error:
            raise StorageError(self.error)
        return key in self.existing

    def delete_prefix(self, prefix: str) -> None:
        if self.error:
            raise StorageError(self.error)
        self.deleted.append(prefix)
        self.existing = {k for k in self.existing if not k.startswith(prefix)}

    def url(self, key: str) -> str:
        return f"https://cdn.test/{key}?sig"
