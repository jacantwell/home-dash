import base64
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import pytest
from botocore.stub import Stubber
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from fastapi import HTTPException

from api.config import Settings
from api.photos import (
    CACHE_CONTROL,
    URL_WINDOW_S,
    CloudFrontSigner,
    S3PhotoStore,
    StorageError,
    album_prefix,
    get_photo_store,
    load_private_key,
    photo_key,
)
from tests.fakes import FakePhotoStore

ALBUM = UUID("11111111-1111-1111-1111-111111111111")
PHOTO = UUID("22222222-2222-2222-2222-222222222222")
CDN = "https://cdn.example.com"
BUCKET = "photos-bucket"
NOW = 1_800_000_000


@pytest.fixture
def private_pem(rsa_keypair: tuple[bytes, Any]) -> str:
    return rsa_keypair[0].decode()


@pytest.fixture
def photo_settings(settings: Settings, private_pem: str) -> Settings:
    return settings.model_copy(
        update={
            "photos_bucket": BUCKET,
            "photos_cdn_url": f"{CDN}/",
            "photos_cdn_key_pair_id": "KPID",
            "photos_cdn_private_key": private_pem,
            "photos_aws_access_key_id": "AKIATEST",
            "photos_aws_secret_access_key": "secret",
        }
    )


def _request(settings: Settings, store: Any = None) -> Any:
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(settings=settings, photo_store=store))
    )


# --- keys -------------------------------------------------------------------------


def test_album_prefix() -> None:
    assert album_prefix(ALBUM) == f"albums/{ALBUM}/"


@pytest.mark.parametrize(
    ("variant", "content_type", "name"),
    [
        ("original", "image/jpeg", "original.jpg"),
        ("original", "image/png", "original.png"),
        ("original", "image/heic", "original.heic"),
        ("original", "image/heif", "original.heif"),
        ("original", "image/webp", "original.webp"),
        ("original", "image/gif", "original.gif"),
        ("display", "image/png", "display.jpg"),
        ("thumb", "image/heic", "thumb.jpg"),
    ],
)
def test_photo_key(variant: str, content_type: str, name: str) -> None:
    assert photo_key(ALBUM, PHOTO, variant, content_type) == f"albums/{ALBUM}/{PHOTO}/{name}"


# --- config -----------------------------------------------------------------------


def test_photos_configured_when_all_set(photo_settings: Settings) -> None:
    assert photo_settings.photos_configured


@pytest.mark.parametrize(
    "field",
    [
        "photos_bucket",
        "photos_cdn_url",
        "photos_cdn_key_pair_id",
        "photos_cdn_private_key",
        "photos_aws_access_key_id",
        "photos_aws_secret_access_key",
    ],
)
def test_photos_not_configured_when_any_missing(photo_settings: Settings, field: str) -> None:
    assert not photo_settings.model_copy(update={field: ""}).photos_configured


def test_photos_region_defaults_to_london() -> None:
    assert Settings(_env_file=None).photos_region == "eu-west-2"


# --- private key ------------------------------------------------------------------


@pytest.mark.parametrize(
    "encode",
    [
        pytest.param(lambda pem: pem, id="pem"),
        pytest.param(lambda pem: f"\n  {pem}  \n", id="pem-padded"),
        pytest.param(lambda pem: base64.b64encode(pem.encode()).decode(), id="base64"),
        pytest.param(lambda pem: f" {base64.b64encode(pem.encode()).decode()}\n", id="b64-padded"),
    ],
)
def test_load_private_key(private_pem: str, rsa_keypair: tuple[bytes, Any], encode: Any) -> None:
    key = load_private_key(encode(private_pem))
    assert key.public_key().public_numbers() == rsa_keypair[1].public_numbers()


def _ec_pem() -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("", id="empty"),
        pytest.param("not a key", id="garbage"),
        pytest.param(base64.b64encode(b"\xff\xfe\x00").decode(), id="b64-not-utf8"),
        pytest.param(base64.b64encode(b"hello").decode(), id="b64-not-pem"),
        pytest.param(_ec_pem(), id="ec-key"),
    ],
)
def test_load_private_key_rejects(value: str) -> None:
    with pytest.raises(ValueError):
        load_private_key(value)


# --- cloudfront signer ------------------------------------------------------------


def _signer(private_pem: str, now: float = NOW, base: str = CDN) -> CloudFrontSigner:
    return CloudFrontSigner(base, "KPID", load_private_key(private_pem), clock=lambda: now)


def _cf_b64decode(value: str) -> bytes:
    return base64.b64decode(value.replace("-", "+").replace("_", "=").replace("~", "/"))


def test_signed_url_verifies_against_public_key(
    private_pem: str, rsa_keypair: tuple[bytes, Any]
) -> None:
    signer = _signer(private_pem)
    url = signer.sign("albums/a/b/thumb.jpg")
    parts = urlsplit(url)
    resource = f"{parts.scheme}://{parts.netloc}{parts.path}"
    assert resource == f"{CDN}/albums/a/b/thumb.jpg"
    query = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert query["Key-Pair-Id"] == "KPID"
    assert int(query["Expires"]) == signer.expires()
    policy = json.dumps(
        {
            "Statement": [
                {
                    "Resource": resource,
                    "Condition": {"DateLessThan": {"AWS:EpochTime": signer.expires()}},
                }
            ]
        },
        separators=(",", ":"),
    )
    public: rsa.RSAPublicKey = rsa_keypair[1]
    # raises InvalidSignature on mismatch
    public.verify(
        _cf_b64decode(query["Signature"]), policy.encode(), padding.PKCS1v15(), hashes.SHA1()
    )


def test_signer_strips_trailing_slash_from_base(private_pem: str) -> None:
    url = _signer(private_pem, base=f"{CDN}//").sign("k.jpg")
    assert url.startswith(f"{CDN}/k.jpg?")


@pytest.mark.parametrize(
    "offset",
    [0, 1, URL_WINDOW_S // 2, URL_WINDOW_S - 1],
    ids=["window-start", "plus-1s", "mid", "window-end"],
)
def test_expiry_is_6_to_12_hours_ahead(private_pem: str, offset: int) -> None:
    start = NOW - NOW % URL_WINDOW_S
    now = start + offset
    ahead = _signer(private_pem, now=now).expires() - now
    assert 6 * 3600 < ahead <= 12 * 3600


def test_url_is_stable_within_a_window(private_pem: str) -> None:
    start = NOW - NOW % URL_WINDOW_S
    urls = {_signer(private_pem, now=start + o).sign("k.jpg") for o in (0, 100, URL_WINDOW_S - 1)}
    assert len(urls) == 1, "same window should give byte-identical URLs"


def test_url_changes_in_next_window(private_pem: str) -> None:
    start = NOW - NOW % URL_WINDOW_S
    first = _signer(private_pem, now=start).expires()
    assert _signer(private_pem, now=start + URL_WINDOW_S).expires() == first + URL_WINDOW_S


# --- get_photo_store --------------------------------------------------------------


def test_get_photo_store_503_when_unconfigured(settings: Settings) -> None:
    with pytest.raises(HTTPException) as exc:
        get_photo_store(_request(settings))
    assert exc.value.status_code == 503


def test_get_photo_store_prefers_injected_store(settings: Settings) -> None:
    store = FakePhotoStore()
    assert get_photo_store(_request(settings, store)) is store


def test_get_photo_store_builds_s3_store_once(photo_settings: Settings) -> None:
    request = _request(photo_settings)
    store = get_photo_store(request)
    assert isinstance(store, S3PhotoStore)
    assert request.app.state.photo_store is store
    assert get_photo_store(request) is store


# --- S3PhotoStore -----------------------------------------------------------------


@pytest.fixture
def s3_store(photo_settings: Settings) -> S3PhotoStore:
    return S3PhotoStore(photo_settings)


@pytest.fixture
def stub(s3_store: S3PhotoStore) -> Any:
    with Stubber(s3_store._s3) as stubber:
        yield stubber
        stubber.assert_no_pending_responses()


def test_presign_upload_pins_type_cache_and_size(s3_store: S3PhotoStore) -> None:
    post = s3_store.presign_upload("albums/a/b/original.png", "image/png", 1234)
    assert post.url == f"https://{BUCKET}.s3.eu-west-2.amazonaws.com/"
    assert post.fields["key"] == "albums/a/b/original.png"
    assert post.fields["Content-Type"] == "image/png"
    assert post.fields["Cache-Control"] == CACHE_CONTROL
    policy = json.loads(base64.b64decode(post.fields["policy"]))
    assert ["content-length-range", 1, 1234] in policy["conditions"]
    assert {"Content-Type": "image/png"} in policy["conditions"]
    expiration = datetime.fromisoformat(policy["expiration"].replace("Z", "+00:00"))
    assert 0 < (expiration - datetime.now(UTC)).total_seconds() <= 15 * 60


def test_url_is_cdn_signed(s3_store: S3PhotoStore) -> None:
    url = s3_store.url("albums/a/b/thumb.jpg")
    assert url.startswith(f"{CDN}/albums/a/b/thumb.jpg?Expires=")
    assert "Key-Pair-Id=KPID" in url


def test_exists_true(s3_store: S3PhotoStore, stub: Any) -> None:
    stub.add_response("head_object", {}, {"Bucket": BUCKET, "Key": "k"})
    assert s3_store.exists("k") is True


@pytest.mark.parametrize("code", ["404", "NoSuchKey", "NotFound"])
def test_exists_false_when_missing(s3_store: S3PhotoStore, stub: Any, code: str) -> None:
    stub.add_client_error("head_object", service_error_code=code, http_status_code=404)
    assert s3_store.exists("k") is False


@pytest.mark.parametrize(("code", "status"), [("403", 403), ("AccessDenied", 403), ("500", 500)])
def test_exists_raises_storage_error(
    s3_store: S3PhotoStore, stub: Any, code: str, status: int
) -> None:
    stub.add_client_error("head_object", service_error_code=code, http_status_code=status)
    with pytest.raises(StorageError):
        s3_store.exists("k")


def _listing(keys: list[str], token: str | None = None) -> dict:
    page: dict[str, Any] = {"IsTruncated": token is not None}
    if keys:
        page["Contents"] = [{"Key": k} for k in keys]
    if token:
        page["NextContinuationToken"] = token
    return page


def _delete(keys: list[str]) -> dict:
    return {"Bucket": BUCKET, "Delete": {"Objects": [{"Key": k} for k in keys], "Quiet": True}}


def test_delete_prefix_deletes_every_page(s3_store: S3PhotoStore, stub: Any) -> None:
    listed = {"Bucket": BUCKET, "Prefix": "albums/a/"}
    stub.add_response("list_objects_v2", _listing(["albums/a/1", "albums/a/2"], "t"), listed)
    stub.add_response("delete_objects", {}, _delete(["albums/a/1", "albums/a/2"]))
    stub.add_response(
        "list_objects_v2", _listing(["albums/a/3"]), {**listed, "ContinuationToken": "t"}
    )
    stub.add_response("delete_objects", {}, _delete(["albums/a/3"]))
    s3_store.delete_prefix("albums/a/")


def test_delete_prefix_skips_empty_listing(s3_store: S3PhotoStore, stub: Any) -> None:
    stub.add_response("list_objects_v2", _listing([]), {"Bucket": BUCKET, "Prefix": "albums/a/"})
    s3_store.delete_prefix("albums/a/")


@pytest.mark.parametrize(
    ("response", "fails"),
    [
        pytest.param({}, False, id="no-errors-key"),
        pytest.param({"Errors": []}, False, id="empty-errors"),
        pytest.param(
            {"Errors": [{"Key": "albums/a/1", "Code": "AccessDenied", "Message": "no"}]},
            True,
            id="one-error",
        ),
    ],
)
def test_delete_prefix_checks_quiet_mode_errors(
    s3_store: S3PhotoStore, stub: Any, response: dict, fails: bool
) -> None:
    stub.add_response("list_objects_v2", _listing(["albums/a/1"]))
    stub.add_response("delete_objects", response, _delete(["albums/a/1"]))
    if fails:
        with pytest.raises(StorageError, match="1 object"):
            s3_store.delete_prefix("albums/a/")
    else:
        s3_store.delete_prefix("albums/a/")


@pytest.mark.parametrize("failing", ["list_objects_v2", "delete_objects"])
def test_delete_prefix_raises_storage_error(
    s3_store: S3PhotoStore, stub: Any, failing: str
) -> None:
    if failing == "delete_objects":
        stub.add_response("list_objects_v2", _listing(["albums/a/1"]))
    stub.add_client_error(failing, service_error_code="AccessDenied", http_status_code=403)
    with pytest.raises(StorageError):
        s3_store.delete_prefix("albums/a/")
