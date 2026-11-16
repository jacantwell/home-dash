from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator

from api.auth import Claims, current_user
from api.photos import (
    ORIGINAL_MAX_BYTES,
    ORIGINAL_TYPES,
    RENDITION_MAX_BYTES,
    VARIANTS,
    AlbumRow,
    PhotoRepo,
    PhotoRow,
    PhotoStore,
    Placement,
    PresignedPost,
    StorageError,
    Variant,
    album_prefix,
    get_photo_repo,
    get_photo_store,
    photo_key,
)

ALBUM_TITLE_MAX = 80
LAYOUT_MAX_ITEMS = 2000
# canvas coordinates, shared with web/src/lib/canvas.ts
BOARD_W = 2400
BOARD_H = 1600
DIMENSION_MAX = 30_000

OriginalType = Literal[
    "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif"
]
assert set(OriginalType.__args__) == set(ORIGINAL_TYPES)

router = APIRouter(prefix="/api")


class AlbumIn(BaseModel):
    title: str

    @field_validator("title")
    @classmethod
    def _normalise_title(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("title must not be empty")
        if len(value) > ALBUM_TITLE_MAX:
            raise ValueError(f"title must be at most {ALBUM_TITLE_MAX} characters")
        return value


class AlbumSummary(BaseModel):
    id: UUID
    title: str
    created_by_name: str
    photo_count: int
    cover_url: str | None
    deletable: bool
    created_at: datetime
    updated_at: datetime


class Photo(BaseModel):
    id: UUID
    album_id: UUID
    uploader_name: str
    content_type: str
    bytes: int
    width: int
    height: int
    thumb_url: str
    display_url: str
    original_url: str
    deletable: bool
    created_at: datetime


class Album(AlbumSummary):
    layout: dict[str, Placement]
    photos: list[Photo]


class AlbumList(BaseModel):
    albums: list[AlbumSummary] = Field(default_factory=list)


class UploadIn(BaseModel):
    content_type: OriginalType
    bytes: int = Field(ge=1, le=ORIGINAL_MAX_BYTES)
    width: int = Field(ge=1, le=DIMENSION_MAX)
    height: int = Field(ge=1, le=DIMENSION_MAX)


class UploadTicket(BaseModel):
    photo_id: UUID
    uploads: dict[Variant, PresignedPost]


class PlacementIn(BaseModel):
    x: float = Field(ge=0, le=BOARD_W)
    y: float = Field(ge=0, le=BOARD_H)
    r: float = Field(ge=-180, le=180)
    s: float = Field(ge=0.25, le=4)
    z: int = Field(ge=0, le=1_000_000)


class LayoutIn(BaseModel):
    items: dict[UUID, PlacementIn] = Field(max_length=LAYOUT_MAX_ITEMS)


class LayoutOut(BaseModel):
    layout: dict[str, Placement]


def _photo_out(photo: PhotoRow, album: AlbumRow, store: PhotoStore, sub: str) -> Photo:
    def url(variant: Variant) -> str:
        return store.url(photo_key(photo.album_id, photo.id, variant, photo.content_type))

    return Photo(
        id=photo.id,
        album_id=photo.album_id,
        uploader_name=photo.uploader_name,
        content_type=photo.content_type,
        bytes=photo.bytes,
        width=photo.width,
        height=photo.height,
        thumb_url=url("thumb"),
        display_url=url("display"),
        original_url=url("original"),
        deletable=sub in (photo.clerk_user_id, album.clerk_user_id),
        created_at=photo.created_at,
    )


def _summary_out(album: AlbumRow, store: PhotoStore, sub: str) -> AlbumSummary:
    cover = None
    if album.cover_photo_id is not None:
        # renditions are always jpg, so the original's type doesn't matter here
        cover = store.url(photo_key(album.id, album.cover_photo_id, "thumb", "image/jpeg"))
    return AlbumSummary(
        id=album.id,
        title=album.title,
        created_by_name=album.created_by_name,
        photo_count=album.photo_count,
        cover_url=cover,
        deletable=album.clerk_user_id == sub,
        created_at=album.created_at,
        updated_at=album.updated_at,
    )


def _album_or_404(repo: PhotoRepo, album_id: UUID) -> AlbumRow:
    album = repo.get_album(album_id)
    if album is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "album not found")
    return album


def _photo_or_404(repo: PhotoRepo, photo_id: UUID) -> PhotoRow:
    photo = repo.get_photo(photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")
    return photo


def _storage_failed(exc: StorageError) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"photo storage failed: {exc}")


def _name(claims: Claims) -> str:
    return str(claims.get("name") or "")


# Everything is signed-in only. `claims` resolves first, so a 401 never opens a DB connection.
Auth = Annotated[Claims, Depends(current_user)]
Repo = Annotated[PhotoRepo, Depends(get_photo_repo)]
Store = Annotated[PhotoStore, Depends(get_photo_store)]


@router.get("/albums", response_model=AlbumList)
def list_albums(
    claims: Auth, store: Store, repo: Repo, limit: int = Query(100, ge=1, le=500)
) -> AlbumList:
    return AlbumList(
        albums=[_summary_out(a, store, claims["sub"]) for a in repo.list_albums(limit)]
    )


@router.post("/albums", response_model=AlbumSummary, status_code=status.HTTP_201_CREATED)
def create_album(body: AlbumIn, claims: Auth, store: Store, repo: Repo) -> AlbumSummary:
    album = repo.create_album(
        title=body.title, clerk_user_id=claims["sub"], created_by_name=_name(claims)
    )
    return _summary_out(album, store, claims["sub"])


@router.get("/albums/{album_id}", response_model=Album)
def get_album(album_id: UUID, claims: Auth, store: Store, repo: Repo) -> Album:
    album = _album_or_404(repo, album_id)
    sub = claims["sub"]
    photos = [_photo_out(p, album, store, sub) for p in repo.list_photos(album_id)]
    return Album(**_summary_out(album, store, sub).model_dump(), layout=album.layout, photos=photos)


@router.delete("/albums/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_album(album_id: UUID, claims: Auth, store: Store, repo: Repo) -> Response:
    album = _album_or_404(repo, album_id)
    if album.clerk_user_id != claims["sub"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the album's creator can delete it")
    try:
        store.delete_prefix(album_prefix(album_id))
    except StorageError as exc:
        raise _storage_failed(exc) from exc
    repo.delete_album(album_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/albums/{album_id}/layout", response_model=LayoutOut)
def save_layout(album_id: UUID, body: LayoutIn, claims: Auth, repo: Repo) -> LayoutOut:
    _album_or_404(repo, album_id)
    # drop anything that isn't a photo in this album (deleted meanwhile, or made up)
    known = {p.id for p in repo.list_photos(album_id)}
    layout = {
        str(pid): Placement(**placement.model_dump())
        for pid, placement in body.items.items()
        if pid in known
    }
    repo.save_layout(album_id, layout)
    return LayoutOut(layout=layout)


@router.post(
    "/albums/{album_id}/photos",
    response_model=UploadTicket,
    status_code=status.HTTP_201_CREATED,
)
def start_upload(
    album_id: UUID, body: UploadIn, claims: Auth, store: Store, repo: Repo
) -> UploadTicket:
    """Reserve a photo and hand back one presigned POST per variant; then call /complete."""
    _album_or_404(repo, album_id)
    photo = repo.create_photo(
        album_id=album_id,
        clerk_user_id=claims["sub"],
        uploader_name=_name(claims),
        content_type=body.content_type,
        bytes=body.bytes,
        width=body.width,
        height=body.height,
    )
    uploads: dict[Variant, PresignedPost] = {}
    for variant in VARIANTS:
        is_original = variant == "original"
        uploads[variant] = store.presign_upload(
            photo_key(album_id, photo.id, variant, body.content_type),
            body.content_type if is_original else "image/jpeg",
            ORIGINAL_MAX_BYTES if is_original else RENDITION_MAX_BYTES,
        )
    return UploadTicket(photo_id=photo.id, uploads=uploads)


@router.post("/photos/{photo_id}/complete", response_model=Photo)
def complete_upload(photo_id: UUID, claims: Auth, store: Store, repo: Repo) -> Photo:
    photo = _photo_or_404(repo, photo_id)
    album = _album_or_404(repo, photo.album_id)
    if photo.status == "pending":
        try:
            missing = [
                v
                for v in VARIANTS
                if not store.exists(photo_key(album.id, photo.id, v, photo.content_type))
            ]
        except StorageError as exc:
            raise _storage_failed(exc) from exc
        if missing:
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"upload not finished: missing {', '.join(missing)}"
            )
        ready = repo.mark_ready(photo_id)
        if ready is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")
        photo = ready
    return _photo_out(photo, album, store, claims["sub"])


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(photo_id: UUID, claims: Auth, store: Store, repo: Repo) -> Response:
    photo = _photo_or_404(repo, photo_id)
    album = _album_or_404(repo, photo.album_id)
    if claims["sub"] not in (photo.clerk_user_id, album.clerk_user_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "only the uploader or the album's creator can delete it"
        )
    try:
        store.delete_prefix(f"{album_prefix(album.id)}{photo.id}/")
    except StorageError as exc:
        raise _storage_failed(exc) from exc
    repo.delete_photo(photo)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
