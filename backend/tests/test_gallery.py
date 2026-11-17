from collections.abc import Callable
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.auth import ClerkVerifier
from api.config import Settings
from api.gallery import (
    ALBUM_TITLE_MAX,
    DIMENSION_MAX,
    LAYOUT_MAX_ITEMS,
    SPACE_H,
    SPACE_HALF,
)
from api.photos import (
    ORIGINAL_MAX_BYTES,
    RENDITION_MAX_BYTES,
    VARIANTS,
    AlbumRow,
    PhotoRow,
    get_photo_repo,
    photo_key,
)
from tests.conftest import TokenFactory
from tests.fakes import FakePhotoStore, InMemoryPhotoRepo

Headers = Callable[[str], dict[str, str]]

CREATOR, UPLOADER, STRANGER = "user_creator", "user_uploader", "user_stranger"
UPLOAD = {"content_type": "image/png", "bytes": 1234, "width": 4000, "height": 3000}
PLACEMENT = {"x": 100, "y": 200, "z": -300, "yaw": 30, "r": 15, "s": 1.5}
# pre-3D shape: int stacking `z`, no `yaw`
STALE_2D = {"x": 1, "y": 2, "r": 0, "s": 1, "z": 3}
MISSING = uuid4()


@pytest.fixture
def repo() -> InMemoryPhotoRepo:
    return InMemoryPhotoRepo()


@pytest.fixture
def store() -> FakePhotoStore:
    return FakePhotoStore()


@pytest.fixture
def client(
    settings: Settings, verifier: ClerkVerifier, repo: InMemoryPhotoRepo, store: FakePhotoStore
) -> TestClient:
    app = create_app(settings, verifier=verifier, photo_store=store)
    app.dependency_overrides[get_photo_repo] = lambda: repo
    return TestClient(app)


@pytest.fixture
def as_user(make_token: TokenFactory) -> Headers:
    def _headers(sub: str = CREATOR) -> dict[str, str]:
        return {"Authorization": f"Bearer {make_token(sub=sub, name=sub.title())}"}

    return _headers


def _album(repo: InMemoryPhotoRepo, owner: str = CREATOR) -> UUID:
    return repo.create_album(title="Trip", clerk_user_id=owner, created_by_name=owner).id


def _photo(
    repo: InMemoryPhotoRepo,
    album_id: UUID,
    uploader: str = UPLOADER,
    *,
    ready: bool = True,
    content_type: str = "image/png",
) -> PhotoRow:
    photo = repo.create_photo(
        album_id=album_id,
        clerk_user_id=uploader,
        uploader_name=uploader,
        content_type=content_type,
        bytes=10,
        width=10,
        height=10,
    )
    return repo.mark_ready(photo.id) if ready else photo


def _keys(photo: PhotoRow) -> set[str]:
    return {photo_key(photo.album_id, photo.id, v, photo.content_type) for v in VARIANTS}


# every route, with a body valid enough to get past validation
ROUTES = [
    ("GET", "/api/albums", None),
    ("POST", "/api/albums", {"title": "Trip"}),
    ("GET", f"/api/albums/{MISSING}", None),
    ("DELETE", f"/api/albums/{MISSING}", None),
    ("PUT", f"/api/albums/{MISSING}/layout", {"items": {}}),
    ("POST", f"/api/albums/{MISSING}/photos", UPLOAD),
    ("POST", f"/api/photos/{MISSING}/complete", None),
    ("DELETE", f"/api/photos/{MISSING}", None),
]
ROUTE_IDS = [f"{m} {p.replace(str(MISSING), '{id}')}" for m, p, _ in ROUTES]


# --- auth / config ----------------------------------------------------------------


@pytest.mark.parametrize(("method", "path", "body"), ROUTES, ids=ROUTE_IDS)
def test_every_route_requires_token(
    client: TestClient, repo: InMemoryPhotoRepo, method: str, path: str, body: dict | None
) -> None:
    assert client.request(method, path, json=body).status_code == 401
    assert repo.albums == {}


@pytest.mark.parametrize(
    ("method", "path", "body", "expected"),
    [(*route, 404 if "layout" in route[1] else 503) for route in ROUTES],
    ids=ROUTE_IDS,
)
def test_unconfigured_storage_is_503_except_layout(
    settings: Settings,
    verifier: ClerkVerifier,
    as_user: Headers,
    method: str,
    path: str,
    body: dict | None,
    expected: int,
) -> None:
    app = create_app(settings, verifier=verifier)
    app.dependency_overrides[get_photo_repo] = lambda: InMemoryPhotoRepo()
    response = TestClient(app).request(method, path, json=body, headers=as_user())
    assert response.status_code == expected


@pytest.mark.parametrize(("method", "path", "body"), ROUTES[2:], ids=ROUTE_IDS[2:])
def test_unknown_ids_are_404(
    client: TestClient, as_user: Headers, method: str, path: str, body: dict | None
) -> None:
    assert client.request(method, path, json=body, headers=as_user()).status_code == 404


# --- albums -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Trip", "Trip"),
        ("  summer \n\t trip  ", "summer trip"),
        ("x" * ALBUM_TITLE_MAX, "x" * ALBUM_TITLE_MAX),
    ],
)
def test_create_album_normalises_title(
    client: TestClient, as_user: Headers, raw: str, expected: str
) -> None:
    response = client.post("/api/albums", json={"title": raw}, headers=as_user())
    assert response.status_code == 201
    assert response.json()["title"] == expected


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({}, id="missing"),
        pytest.param({"title": ""}, id="empty"),
        pytest.param({"title": " \n\t "}, id="whitespace-only"),
        pytest.param({"title": "x" * (ALBUM_TITLE_MAX + 1)}, id="too-long"),
        pytest.param({"title": None}, id="null"),
        pytest.param({"title": 5}, id="not-string"),
    ],
)
def test_create_album_rejects_bad_title(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, body: dict
) -> None:
    assert client.post("/api/albums", json=body, headers=as_user()).status_code == 422
    assert repo.albums == {}


def test_create_album_returns_summary(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo
) -> None:
    body = client.post("/api/albums", json={"title": "Trip"}, headers=as_user()).json()
    assert body["created_by_name"] == "User_Creator"
    assert (body["photo_count"], body["cover_url"], body["deletable"]) == (0, None, True)
    assert repo.albums[UUID(body["id"])].clerk_user_id == CREATOR


@pytest.mark.parametrize(("sub", "deletable"), [(CREATOR, True), (STRANGER, False)])
def test_list_albums_deletable_per_caller(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, sub: str, deletable: bool
) -> None:
    _album(repo)
    albums = client.get("/api/albums", headers=as_user(sub)).json()["albums"]
    assert [a["deletable"] for a in albums] == [deletable]


def test_list_albums_counts_ready_photos_and_uses_first_as_cover(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo
) -> None:
    album_id = _album(repo)
    _photo(repo, album_id, ready=False)
    first = _photo(repo, album_id, content_type="image/heic")
    _photo(repo, album_id)
    (album,) = client.get("/api/albums", headers=as_user()).json()["albums"]
    assert album["photo_count"] == 2, "pending photos don't count"
    assert album["cover_url"] == f"https://cdn.test/albums/{album_id}/{first.id}/thumb.jpg?sig"


@pytest.mark.parametrize(("query", "expected"), [("", 3), ("?limit=2", 2), ("?limit=500", 3)])
def test_list_albums_limit(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, query: str, expected: int
) -> None:
    for _ in range(3):
        _album(repo)
    response = client.get(f"/api/albums{query}", headers=as_user())
    assert len(response.json()["albums"]) == expected


@pytest.mark.parametrize("limit", ["0", "501", "abc"])
def test_list_albums_limit_out_of_bounds(client: TestClient, as_user: Headers, limit: str) -> None:
    assert client.get(f"/api/albums?limit={limit}", headers=as_user()).status_code == 422


def test_get_album_lists_ready_photos_with_urls(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo
) -> None:
    album_id = _album(repo)
    photo = _photo(repo, album_id, content_type="image/webp")
    _photo(repo, album_id, ready=False)
    body = client.get(f"/api/albums/{album_id}", headers=as_user()).json()
    (out,) = body["photos"]
    base = f"https://cdn.test/albums/{album_id}/{photo.id}"
    assert (out["thumb_url"], out["display_url"], out["original_url"]) == (
        f"{base}/thumb.jpg?sig",
        f"{base}/display.jpg?sig",
        f"{base}/original.webp?sig",
    )
    assert body["layout"] == {}


# --- ownership --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sub", "album_deletable", "photo_deletable"),
    [(CREATOR, True, True), (UPLOADER, False, True), (STRANGER, False, False)],
)
def test_deletable_flags_per_caller(
    client: TestClient,
    as_user: Headers,
    repo: InMemoryPhotoRepo,
    sub: str,
    album_deletable: bool,
    photo_deletable: bool,
) -> None:
    album_id = _album(repo)
    _photo(repo, album_id)
    body = client.get(f"/api/albums/{album_id}", headers=as_user(sub)).json()
    assert body["deletable"] is album_deletable
    assert body["photos"][0]["deletable"] is photo_deletable


@pytest.mark.parametrize(("sub", "expected"), [(CREATOR, 204), (UPLOADER, 403), (STRANGER, 403)])
def test_delete_album_only_by_creator(
    client: TestClient,
    as_user: Headers,
    repo: InMemoryPhotoRepo,
    store: FakePhotoStore,
    sub: str,
    expected: int,
) -> None:
    album_id = _album(repo)
    _photo(repo, album_id)
    response = client.delete(f"/api/albums/{album_id}", headers=as_user(sub))
    assert response.status_code == expected
    deleted = expected == 204
    assert (album_id not in repo.albums) is deleted
    assert store.deleted == ([f"albums/{album_id}/"] if deleted else [])


@pytest.mark.parametrize(("sub", "expected"), [(CREATOR, 204), (UPLOADER, 204), (STRANGER, 403)])
def test_delete_photo_by_uploader_or_album_creator(
    client: TestClient,
    as_user: Headers,
    repo: InMemoryPhotoRepo,
    store: FakePhotoStore,
    sub: str,
    expected: int,
) -> None:
    album_id = _album(repo)
    photo = _photo(repo, album_id)
    response = client.delete(f"/api/photos/{photo.id}", headers=as_user(sub))
    assert response.status_code == expected
    deleted = expected == 204
    assert (photo.id not in repo.photos) is deleted
    assert store.deleted == ([f"albums/{album_id}/{photo.id}/"] if deleted else [])


# --- storage failures -------------------------------------------------------------


@pytest.mark.parametrize("target", ["album", "photo", "complete"])
def test_storage_error_is_502_and_leaves_rows(
    client: TestClient,
    as_user: Headers,
    repo: InMemoryPhotoRepo,
    store: FakePhotoStore,
    target: str,
) -> None:
    album_id = _album(repo)
    photo = _photo(repo, album_id, uploader=CREATOR, ready=target != "complete")
    store.error = "boom"
    request = {
        "album": ("DELETE", f"/api/albums/{album_id}"),
        "photo": ("DELETE", f"/api/photos/{photo.id}"),
        "complete": ("POST", f"/api/photos/{photo.id}/complete"),
    }[target]
    response = client.request(*request, headers=as_user())
    assert response.status_code == 502
    assert "boom" in response.json()["detail"]
    assert album_id in repo.albums and photo.id in repo.photos
    assert repo.photos[photo.id].status == photo.status


# --- layout -----------------------------------------------------------------------


def test_save_layout_drops_photos_not_in_album(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo
) -> None:
    album_id = _album(repo)
    kept = _photo(repo, album_id)
    pending = _photo(repo, album_id, ready=False)
    elsewhere = _photo(repo, _album(repo))
    items = {str(pid): PLACEMENT for pid in (kept.id, pending.id, elsewhere.id, uuid4())}
    response = client.put(
        f"/api/albums/{album_id}/layout", json={"items": items}, headers=as_user(STRANGER)
    )
    assert response.status_code == 200
    expected = {str(kept.id): PLACEMENT}
    assert response.json()["layout"] == expected
    assert client.get(f"/api/albums/{album_id}", headers=as_user()).json()["layout"] == expected


@pytest.mark.parametrize(
    "placement",
    [
        {"x": -SPACE_HALF, "y": 0, "z": -SPACE_HALF, "yaw": -180, "r": -180, "s": 0.25},
        {"x": SPACE_HALF, "y": SPACE_H, "z": SPACE_HALF, "yaw": 180, "r": 180, "s": 4},
    ],
    ids=["min", "max"],
)
def test_save_layout_accepts_bounds(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, placement: dict
) -> None:
    album_id = _album(repo)
    photo = _photo(repo, album_id)
    body = {"items": {str(photo.id): placement}}
    response = client.put(f"/api/albums/{album_id}/layout", json=body, headers=as_user())
    assert response.json()["layout"] == {str(photo.id): placement}


@pytest.mark.parametrize(
    "placement",
    [
        pytest.param({**PLACEMENT, "x": -SPACE_HALF - 1}, id="x-low"),
        pytest.param({**PLACEMENT, "x": SPACE_HALF + 1}, id="x-high"),
        pytest.param({**PLACEMENT, "y": -1}, id="y-low"),
        pytest.param({**PLACEMENT, "y": SPACE_H + 1}, id="y-high"),
        pytest.param({**PLACEMENT, "z": -SPACE_HALF - 1}, id="z-low"),
        pytest.param({**PLACEMENT, "z": SPACE_HALF + 1}, id="z-high"),
        pytest.param({**PLACEMENT, "yaw": -181}, id="yaw-low"),
        pytest.param({**PLACEMENT, "yaw": 181}, id="yaw-high"),
        pytest.param({**PLACEMENT, "r": -181}, id="r-low"),
        pytest.param({**PLACEMENT, "r": 181}, id="r-high"),
        pytest.param({**PLACEMENT, "s": 0.24}, id="s-low"),
        pytest.param({**PLACEMENT, "s": 4.01}, id="s-high"),
        *[pytest.param({**PLACEMENT, k: None}, id=f"{k}-null") for k in PLACEMENT],
        *[
            pytest.param({f: v for f, v in PLACEMENT.items() if f != k}, id=f"{k}-missing")
            for k in PLACEMENT
        ],
        pytest.param(STALE_2D, id="stale-2d"),
    ],
)
def test_save_layout_rejects_out_of_bounds_placement(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, placement: dict
) -> None:
    album_id = _album(repo)
    photo = _photo(repo, album_id)
    body = {"items": {str(photo.id): placement}}
    response = client.put(f"/api/albums/{album_id}/layout", json=body, headers=as_user())
    assert response.status_code == 422
    assert repo.albums[album_id].layout == {}


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({}, id="no-items"),
        pytest.param({"items": {"not-a-uuid": PLACEMENT}}, id="bad-key"),
        pytest.param({"items": {str(uuid4()): {"x": 1}}}, id="partial-placement"),
        pytest.param(
            {"items": {str(uuid4()): PLACEMENT for _ in range(LAYOUT_MAX_ITEMS + 1)}},
            id="too-many",
        ),
    ],
)
def test_save_layout_rejects_bad_body(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, body: dict
) -> None:
    album_id = _album(repo)
    response = client.put(f"/api/albums/{album_id}/layout", json=body, headers=as_user())
    assert response.status_code == 422


@pytest.mark.parametrize(
    "stale",
    [
        pytest.param(STALE_2D, id="2d-shape"),
        pytest.param({k: v for k, v in PLACEMENT.items() if k != "yaw"}, id="no-yaw"),
        pytest.param({**PLACEMENT, "z": "deep"}, id="non-numeric"),
        pytest.param(None, id="null"),
        pytest.param([1, 2, 3], id="not-object"),
    ],
)
def test_get_album_skips_stale_layout_entries(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, stale: object
) -> None:
    album_id = _album(repo)
    kept, old = _photo(repo, album_id), _photo(repo, album_id)
    raw = {str(old.id): stale, str(kept.id): PLACEMENT}
    # validate a raw dict like PostgresPhotoRepo does with the jsonb row
    row = {**repo.albums[album_id].model_dump(), "layout": raw}
    repo.albums[album_id] = AlbumRow.model_validate(row)
    response = client.get(f"/api/albums/{album_id}", headers=as_user())
    assert response.status_code == 200
    assert response.json()["layout"] == {str(kept.id): PLACEMENT}, "stale entry is dropped"


# --- upload -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("content_type", "ext"),
    [
        ("image/jpeg", "jpg"),
        ("image/png", "png"),
        ("image/heic", "heic"),
        ("image/heif", "heif"),
        ("image/webp", "webp"),
        ("image/gif", "gif"),
    ],
)
def test_start_upload_presigns_each_variant(
    client: TestClient,
    as_user: Headers,
    repo: InMemoryPhotoRepo,
    store: FakePhotoStore,
    content_type: str,
    ext: str,
) -> None:
    album_id = _album(repo)
    body = {**UPLOAD, "content_type": content_type}
    response = client.post(f"/api/albums/{album_id}/photos", json=body, headers=as_user(UPLOADER))
    assert response.status_code == 201
    ticket = response.json()
    photo_id = ticket["photo_id"]
    prefix = f"albums/{album_id}/{photo_id}"
    assert store.presigned == [
        (f"{prefix}/original.{ext}", content_type, ORIGINAL_MAX_BYTES),
        (f"{prefix}/display.jpg", "image/jpeg", RENDITION_MAX_BYTES),
        (f"{prefix}/thumb.jpg", "image/jpeg", RENDITION_MAX_BYTES),
    ]
    assert {v: u["fields"]["key"] for v, u in ticket["uploads"].items()} == {
        "original": f"{prefix}/original.{ext}",
        "display": f"{prefix}/display.jpg",
        "thumb": f"{prefix}/thumb.jpg",
    }
    photo = repo.photos[UUID(photo_id)]
    assert (photo.status, photo.clerk_user_id, photo.uploader_name) == (
        "pending",
        UPLOADER,
        "User_Uploader",
    )


@pytest.mark.parametrize(
    "override",
    [
        pytest.param({"bytes": ORIGINAL_MAX_BYTES}, id="max-bytes"),
        pytest.param({"bytes": 1, "width": 1, "height": 1}, id="min"),
        pytest.param({"width": DIMENSION_MAX, "height": DIMENSION_MAX}, id="max-dimensions"),
    ],
)
def test_start_upload_accepts_bounds(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, override: dict
) -> None:
    album_id = _album(repo)
    body = {**UPLOAD, **override}
    response = client.post(f"/api/albums/{album_id}/photos", json=body, headers=as_user())
    assert response.status_code == 201


@pytest.mark.parametrize(
    "override",
    [
        pytest.param({"content_type": "image/tiff"}, id="tiff"),
        pytest.param({"content_type": "text/plain"}, id="text"),
        pytest.param({"content_type": "IMAGE/PNG"}, id="uppercase-type"),
        pytest.param({"bytes": 0}, id="zero-bytes"),
        pytest.param({"bytes": ORIGINAL_MAX_BYTES + 1}, id="too-big"),
        pytest.param({"width": 0}, id="zero-width"),
        pytest.param({"width": DIMENSION_MAX + 1}, id="too-wide"),
        pytest.param({"height": 0}, id="zero-height"),
        pytest.param({"height": DIMENSION_MAX + 1}, id="too-tall"),
        pytest.param({"width": None}, id="null-width"),
    ],
)
def test_start_upload_rejects_bad_body(
    client: TestClient,
    as_user: Headers,
    repo: InMemoryPhotoRepo,
    store: FakePhotoStore,
    override: dict,
) -> None:
    album_id = _album(repo)
    body = {**UPLOAD, **override}
    response = client.post(f"/api/albums/{album_id}/photos", json=body, headers=as_user())
    assert response.status_code == 422
    assert repo.photos == {} and store.presigned == []


def test_start_upload_unknown_album_reserves_nothing(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, store: FakePhotoStore
) -> None:
    response = client.post(f"/api/albums/{MISSING}/photos", json=UPLOAD, headers=as_user())
    assert response.status_code == 404
    assert repo.photos == {} and store.presigned == []


# --- complete ---------------------------------------------------------------------


def test_complete_marks_photo_ready(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, store: FakePhotoStore
) -> None:
    album_id = _album(repo)
    photo = _photo(repo, album_id, ready=False)
    store.existing = _keys(photo)
    response = client.post(f"/api/photos/{photo.id}/complete", headers=as_user(UPLOADER))
    assert response.status_code == 200
    assert response.json()["id"] == str(photo.id)
    assert response.json()["deletable"] is True
    assert repo.photos[photo.id].status == "ready"


@pytest.mark.parametrize(
    "missing",
    [("original",), ("display",), ("thumb",), ("display", "thumb"), VARIANTS],
    ids=lambda m: "+".join(m),
)
def test_complete_with_missing_variants_is_409(
    client: TestClient,
    as_user: Headers,
    repo: InMemoryPhotoRepo,
    store: FakePhotoStore,
    missing: tuple[str, ...],
) -> None:
    album_id = _album(repo)
    photo = _photo(repo, album_id, ready=False)
    store.existing = {
        photo_key(album_id, photo.id, v, photo.content_type) for v in VARIANTS if v not in missing
    }
    response = client.post(f"/api/photos/{photo.id}/complete", headers=as_user())
    assert response.status_code == 409
    assert response.json()["detail"] == f"upload not finished: missing {', '.join(missing)}"
    assert repo.photos[photo.id].status == "pending"


def test_complete_is_idempotent_on_ready_photo(
    client: TestClient, as_user: Headers, repo: InMemoryPhotoRepo, store: FakePhotoStore
) -> None:
    photo = _photo(repo, _album(repo))
    response = client.post(f"/api/photos/{photo.id}/complete", headers=as_user())
    assert response.status_code == 200
    assert store.checked == [], "ready photos skip the S3 checks"


class _VanishingRepo(InMemoryPhotoRepo):
    """Photo gets deleted between the route's lookup and mark_ready."""

    def mark_ready(self, photo_id: UUID) -> PhotoRow | None:
        self.photos.pop(photo_id, None)
        return super().mark_ready(photo_id)


def test_complete_404_when_photo_vanishes_mid_request(
    settings: Settings, verifier: ClerkVerifier, as_user: Headers, store: FakePhotoStore
) -> None:
    repo = _VanishingRepo()
    photo = _photo(repo, _album(repo), ready=False)
    store.existing = _keys(photo)
    app = create_app(settings, verifier=verifier, photo_store=store)
    app.dependency_overrides[get_photo_repo] = lambda: repo
    response = TestClient(app).post(f"/api/photos/{photo.id}/complete", headers=as_user())
    assert response.status_code == 404
    assert response.json()["detail"] == "photo not found"


@pytest.mark.parametrize("exists", [True, False], ids=["present", "missing"])
def test_in_memory_mark_ready_returns_none_for_missing_photo(exists: bool) -> None:
    repo = InMemoryPhotoRepo()
    photo_id = _photo(repo, _album(repo), ready=False).id if exists else uuid4()
    result = repo.mark_ready(photo_id)
    assert (result is not None and result.status == "ready") if exists else result is None
