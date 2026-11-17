import base64
import binascii
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any, Literal, Protocol
from uuid import UUID

import psycopg
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import HTTPException, Request, status
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ValidationError, field_validator

from api.config import Settings

# Originals are kept as uploaded; the browser also makes these two JPEG renditions.
Variant = Literal["original", "display", "thumb"]
VARIANTS: tuple[Variant, ...] = ("original", "display", "thumb")
ORIGINAL_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/webp": "webp",
    "image/gif": "gif",
}
ORIGINAL_MAX_BYTES = 50 * 1024 * 1024
RENDITION_MAX_BYTES = 10 * 1024 * 1024
# keys never get reused (uuid per photo), so caches can keep them forever
CACHE_CONTROL = "public, max-age=31536000, immutable"
UPLOAD_EXPIRES_S = 15 * 60
# signed URLs stay identical for a whole window so browsers can cache the images
URL_WINDOW_S = 6 * 60 * 60

PhotoStatus = Literal["pending", "ready"]


def album_prefix(album_id: UUID) -> str:
    return f"albums/{album_id}/"


def photo_key(album_id: UUID, photo_id: UUID, variant: Variant, content_type: str) -> str:
    ext = ORIGINAL_TYPES[content_type] if variant == "original" else "jpg"
    return f"{album_prefix(album_id)}{photo_id}/{variant}.{ext}"


# --- rows ---


class Placement(BaseModel):
    """A photo in the 3D canvas: centre (x, y up, z), turn (yaw), tilt (r), size (s)."""

    x: float
    y: float
    z: float
    yaw: float
    r: float
    s: float


def _is_placement(value: Any) -> bool:
    try:
        Placement.model_validate(value)
    except ValidationError:
        return False
    return True


class AlbumRow(BaseModel):
    id: UUID
    title: str
    clerk_user_id: str
    created_by_name: str
    layout: dict[str, Placement]
    photo_count: int
    cover_photo_id: UUID | None
    created_at: datetime
    updated_at: datetime

    @field_validator("layout", mode="before")
    @classmethod
    def _skip_stale_placements(cls, value: Any) -> Any:
        # pre-3D entries get dropped, not 500'd
        if not isinstance(value, dict):
            return value
        return {k: v for k, v in value.items() if _is_placement(v)}


class PhotoRow(BaseModel):
    id: UUID
    album_id: UUID
    clerk_user_id: str
    uploader_name: str
    status: PhotoStatus
    content_type: str
    bytes: int
    width: int
    height: int
    created_at: datetime


_ALBUM_SELECT = """
    SELECT a.id, a.title, a.clerk_user_id, a.created_by_name, a.layout,
           a.created_at, a.updated_at,
           (SELECT count(*) FROM photos p WHERE p.album_id = a.id AND p.status = 'ready')
             AS photo_count,
           (SELECT p.id FROM photos p WHERE p.album_id = a.id AND p.status = 'ready'
             ORDER BY p.created_at, p.id LIMIT 1) AS cover_photo_id
    FROM albums a
"""

_PHOTO_COLUMNS = (
    "id, album_id, clerk_user_id, uploader_name, status, content_type, bytes, width, height,"
    " created_at"
)


class PhotoRepo(Protocol):
    """What the routes need; swapped for an in-memory fake in tests."""

    def list_albums(self, limit: int) -> list[AlbumRow]: ...

    def get_album(self, album_id: UUID) -> AlbumRow | None: ...

    def create_album(self, *, title: str, clerk_user_id: str, created_by_name: str) -> AlbumRow: ...

    def delete_album(self, album_id: UUID) -> None: ...

    def save_layout(self, album_id: UUID, layout: dict[str, Placement]) -> None: ...

    def list_photos(self, album_id: UUID) -> list[PhotoRow]: ...

    def get_photo(self, photo_id: UUID) -> PhotoRow | None: ...

    def create_photo(
        self,
        *,
        album_id: UUID,
        clerk_user_id: str,
        uploader_name: str,
        content_type: str,
        bytes: int,
        width: int,
        height: int,
    ) -> PhotoRow: ...

    def mark_ready(self, photo_id: UUID) -> PhotoRow | None: ...

    def delete_photo(self, photo: PhotoRow) -> None: ...


class PostgresPhotoRepo:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def list_albums(self, limit: int) -> list[AlbumRow]:
        rows = self._conn.execute(
            f"{_ALBUM_SELECT} ORDER BY a.updated_at DESC, a.id LIMIT %s", (limit,)
        ).fetchall()
        return [AlbumRow.model_validate(row) for row in rows]

    def get_album(self, album_id: UUID) -> AlbumRow | None:
        row = self._conn.execute(f"{_ALBUM_SELECT} WHERE a.id = %s", (album_id,)).fetchone()
        return AlbumRow.model_validate(row) if row else None

    def create_album(self, *, title: str, clerk_user_id: str, created_by_name: str) -> AlbumRow:
        row = self._conn.execute(
            "INSERT INTO albums (title, clerk_user_id, created_by_name) VALUES (%s, %s, %s)"
            " RETURNING id",
            (title, clerk_user_id, created_by_name),
        ).fetchone()
        album = self.get_album(row["id"])
        assert album is not None
        return album

    def delete_album(self, album_id: UUID) -> None:
        self._conn.execute("DELETE FROM albums WHERE id = %s", (album_id,))

    def save_layout(self, album_id: UUID, layout: dict[str, Placement]) -> None:
        self._conn.execute(
            "UPDATE albums SET layout = %s, updated_at = now() WHERE id = %s",
            (Jsonb({k: v.model_dump() for k, v in layout.items()}), album_id),
        )

    def list_photos(self, album_id: UUID) -> list[PhotoRow]:
        rows = self._conn.execute(
            f"SELECT {_PHOTO_COLUMNS} FROM photos WHERE album_id = %s AND status = 'ready'"
            " ORDER BY created_at, id",
            (album_id,),
        ).fetchall()
        return [PhotoRow.model_validate(row) for row in rows]

    def get_photo(self, photo_id: UUID) -> PhotoRow | None:
        row = self._conn.execute(
            f"SELECT {_PHOTO_COLUMNS} FROM photos WHERE id = %s", (photo_id,)
        ).fetchone()
        return PhotoRow.model_validate(row) if row else None

    def create_photo(self, **kwargs: Any) -> PhotoRow:
        row = self._conn.execute(
            f"""
            INSERT INTO photos
              (album_id, clerk_user_id, uploader_name, content_type, bytes, width, height)
            VALUES (%(album_id)s, %(clerk_user_id)s, %(uploader_name)s, %(content_type)s,
                    %(bytes)s, %(width)s, %(height)s)
            RETURNING {_PHOTO_COLUMNS}
            """,
            kwargs,
        ).fetchone()
        return PhotoRow.model_validate(row)

    def mark_ready(self, photo_id: UUID) -> PhotoRow | None:
        row = self._conn.execute(
            f"UPDATE photos SET status = 'ready' WHERE id = %s RETURNING {_PHOTO_COLUMNS}",
            (photo_id,),
        ).fetchone()
        if row is None:  # deleted since the route looked it up
            return None
        self._conn.execute("UPDATE albums SET updated_at = now() WHERE id = %s", (row["album_id"],))
        return PhotoRow.model_validate(row)

    def delete_photo(self, photo: PhotoRow) -> None:
        self._conn.execute("DELETE FROM photos WHERE id = %s", (photo.id,))
        self._conn.execute(
            "UPDATE albums SET layout = layout - %s WHERE id = %s",
            (str(photo.id), photo.album_id),
        )


def get_photo_repo(request: Request) -> Iterator[PhotoRepo]:
    database_url: str = request.app.state.settings.database_url
    if not database_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "DATABASE_URL is not configured")
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        yield PostgresPhotoRepo(conn)


# --- storage ---


class PresignedPost(BaseModel):
    """POST `fields` + the file (last) as multipart/form-data to `url`."""

    url: str
    fields: dict[str, str]


class StorageError(Exception):
    pass


class PhotoStore(Protocol):
    def presign_upload(self, key: str, content_type: str, max_bytes: int) -> PresignedPost: ...

    def exists(self, key: str) -> bool: ...

    def delete_prefix(self, prefix: str) -> None: ...

    def url(self, key: str) -> str: ...


def load_private_key(value: str) -> rsa.RSAPrivateKey:
    """PEM as-is, or base64 of the PEM so it fits on one env var line."""
    value = value.strip()
    if not value.startswith("-----BEGIN"):
        try:
            value = base64.b64decode(value).decode()
        except (binascii.Error, UnicodeDecodeError) as exc:
            raise ValueError("PHOTOS_CDN_PRIVATE_KEY is neither PEM nor base64 PEM") from exc
    key = serialization.load_pem_private_key(value.encode(), password=None)
    if not isinstance(key, rsa.RSAPrivateKey):
        raise ValueError("PHOTOS_CDN_PRIVATE_KEY must be an RSA key")
    return key


class CloudFrontSigner:
    """Canned-policy signed URLs via botocore's signer."""

    def __init__(
        self, base_url: str, key_pair_id: str, private_key: rsa.RSAPrivateKey, clock=time.time
    ) -> None:
        from botocore.signers import CloudFrontSigner as BotoSigner

        self.base_url = base_url.rstrip("/")
        self._clock = clock
        self._signer = BotoSigner(
            key_pair_id, lambda msg: private_key.sign(msg, padding.PKCS1v15(), hashes.SHA1())
        )

    def expires(self) -> int:
        now = int(self._clock())
        return (now // URL_WINDOW_S + 2) * URL_WINDOW_S

    def sign(self, key: str) -> str:
        return self._signer.generate_presigned_url(
            f"{self.base_url}/{key}", date_less_than=datetime.fromtimestamp(self.expires(), UTC)
        )


class S3PhotoStore:
    def __init__(self, settings: Settings) -> None:
        # boto3 is slow to import; only pay for it on routes that touch photos
        import boto3
        from botocore.config import Config

        self.bucket = settings.photos_bucket
        self._s3 = boto3.client(
            "s3",
            region_name=settings.photos_region,
            # regional endpoint, otherwise POSTs get a redirect the browser's CORS check rejects
            endpoint_url=f"https://s3.{settings.photos_region}.amazonaws.com",
            aws_access_key_id=settings.photos_aws_access_key_id,
            aws_secret_access_key=settings.photos_aws_secret_access_key,
            config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
        )
        self._signer = CloudFrontSigner(
            settings.photos_cdn_url,
            settings.photos_cdn_key_pair_id,
            load_private_key(settings.photos_cdn_private_key),
        )

    def presign_upload(self, key: str, content_type: str, max_bytes: int) -> PresignedPost:
        post = self._s3.generate_presigned_post(
            Bucket=self.bucket,
            Key=key,
            Fields={"Content-Type": content_type, "Cache-Control": CACHE_CONTROL},
            Conditions=[
                {"Content-Type": content_type},
                {"Cache-Control": CACHE_CONTROL},
                ["content-length-range", 1, max_bytes],
            ],
            ExpiresIn=UPLOAD_EXPIRES_S,
        )
        return PresignedPost(url=post["url"], fields=post["fields"])

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._s3.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise StorageError(str(exc)) from exc
        return True

    def delete_prefix(self, prefix: str) -> None:
        from botocore.exceptions import ClientError

        try:
            pages = self._s3.get_paginator("list_objects_v2").paginate(
                Bucket=self.bucket, Prefix=prefix
            )
            for page in pages:
                objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
                if objects:
                    resp = self._s3.delete_objects(
                        Bucket=self.bucket, Delete={"Objects": objects, "Quiet": True}
                    )
                    # Quiet mode still reports per-key failures
                    if errors := resp.get("Errors"):
                        raise StorageError(f"couldn't delete {len(errors)} object(s)")
        except ClientError as exc:
            raise StorageError(str(exc)) from exc

    def url(self, key: str) -> str:
        return self._signer.sign(key)


def get_photo_store(request: Request) -> PhotoStore:
    store: PhotoStore | None = request.app.state.photo_store
    if store is None:
        settings: Settings = request.app.state.settings
        if not settings.photos_configured:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "photo storage is not configured"
            )
        store = request.app.state.photo_store = S3PhotoStore(settings)
    return store
