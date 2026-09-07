from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from api.app import COMMENT_MAX, create_app
from api.auth import ClerkVerifier
from api.comments import COMMENT_TTL, Comment, get_comment_repo
from api.config import Settings
from tests.fakes import InMemoryCommentRepo

URL = "/api/chatroom/hello-world/comments"


@pytest.fixture
def repo() -> InMemoryCommentRepo:
    return InMemoryCommentRepo()


@pytest.fixture
def client(settings: Settings, verifier: ClerkVerifier, repo: InMemoryCommentRepo) -> TestClient:
    app = create_app(settings, verifier=verifier)
    app.dependency_overrides[get_comment_repo] = lambda: repo
    return TestClient(app)


# --- no auth --------------------------------------------------------------------


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_comments_need_no_token(client: TestClient, method: str) -> None:
    body = {"text": "hi", "color": "#ff0000"}
    response = client.request(method, URL, json=body)
    assert response.status_code in (200, 201)


def test_unconfigured_auth_does_not_block_comments(settings: Settings) -> None:
    app = create_app(settings.model_copy(update={"clerk_issuer": ""}))
    app.dependency_overrides[get_comment_repo] = lambda: InMemoryCommentRepo()
    assert TestClient(app).get(URL).status_code == 200


# --- slugs ------------------------------------------------------------------------


@pytest.mark.parametrize("slug", ["a", "hello-world", "post-2", "0"])
def test_slug_accepted(client: TestClient, slug: str) -> None:
    assert client.get(f"/api/chatroom/{slug}/comments").status_code == 200


@pytest.mark.parametrize(
    "slug",
    [
        pytest.param("Hello", id="uppercase"),
        pytest.param("hello_world", id="underscore"),
        pytest.param("-lead", id="leading-dash"),
        pytest.param("trail-", id="trailing-dash"),
        pytest.param("a--b", id="double-dash"),
        pytest.param("x" * 65, id="too-long"),
        pytest.param("%20", id="space"),
    ],
)
def test_slug_rejected(client: TestClient, repo: InMemoryCommentRepo, slug: str) -> None:
    assert client.get(f"/api/chatroom/{slug}/comments").status_code == 422
    body = {"text": "hi", "color": "#ff0000"}
    assert client.post(f"/api/chatroom/{slug}/comments", json=body).status_code == 422
    assert repo.rows == []


# --- validation -------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({}, id="empty-body"),
        pytest.param({"color": "#ff0000"}, id="no-text"),
        pytest.param({"text": "hi"}, id="no-color"),
        pytest.param({"text": "", "color": "#ff0000"}, id="empty-text"),
        pytest.param({"text": " \n\t \n ", "color": "#ff0000"}, id="whitespace-only"),
        pytest.param({"text": "x" * (COMMENT_MAX + 1), "color": "#ff0000"}, id="too-long"),
        pytest.param(
            {"text": "\n".join("abc" for _ in range(6)), "color": "#ff0000"}, id="6-lines"
        ),
        pytest.param({"text": 123, "color": "#ff0000"}, id="text-not-string"),
        pytest.param({"text": "hi", "color": None}, id="color-null"),
        pytest.param({"text": "hi", "color": ""}, id="color-empty"),
        pytest.param({"text": "hi", "color": "red"}, id="color-name"),
        pytest.param({"text": "hi", "color": "#fff"}, id="color-short"),
        pytest.param({"text": "hi", "color": "ff00ff"}, id="color-no-hash"),
    ],
)
def test_post_rejects_bad_body(client: TestClient, repo: InMemoryCommentRepo, body: dict) -> None:
    assert client.post(URL, json=body).status_code == 422
    assert repo.rows == []


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  hello   world \n", "hello world"),
        ("line one\n\n\n  line   two  ", "line one\nline two"),
        ("a\r\nb\r\nc", "a\nb\nc"),
        ("x" * COMMENT_MAX, "x" * COMMENT_MAX),
        ("\n".join("l" for _ in range(5)), "l\nl\nl\nl\nl"),
    ],
)
def test_post_normalises_text(client: TestClient, raw: str, expected: str) -> None:
    response = client.post(URL, json={"text": raw, "color": "#ff0000"})
    assert response.status_code == 201
    assert response.json()["text"] == expected


@pytest.mark.parametrize(("color", "expected"), [("#FF00aa", "#ff00aa"), ("#00ff00", "#00ff00")])
def test_post_normalises_color(client: TestClient, color: str, expected: str) -> None:
    response = client.post(URL, json={"text": "hi", "color": color})
    assert response.status_code == 201
    assert response.json()["color"] == expected


def test_post_returns_comment_with_expiry(client: TestClient, repo: InMemoryCommentRepo) -> None:
    response = client.post(URL, json={"text": "hello", "color": "#ff0000"})
    assert response.status_code == 201
    body = response.json()
    assert body["post_slug"] == "hello-world"
    assert isinstance(body["id"], int)
    assert "anon" not in body  # nothing identifying is stored or returned
    created = datetime.fromisoformat(body["created_at"])
    expires = datetime.fromisoformat(body["expires_at"])
    assert expires - created == COMMENT_TTL
    assert len(repo.rows) == 1


# --- listing ----------------------------------------------------------------------


def _seed(repo: InMemoryCommentRepo, n: int, slug: str = "hello-world") -> None:
    for i in range(n):
        repo.insert(post_slug=slug, color="#ff0000", text=f"c {i}")


def test_list_oldest_first_and_scoped_to_slug(
    client: TestClient, repo: InMemoryCommentRepo
) -> None:
    _seed(repo, 3)
    _seed(repo, 2, slug="other-post")
    response = client.get(URL)
    assert response.status_code == 200
    assert [c["text"] for c in response.json()["comments"]] == ["c 0", "c 1", "c 2"]


@pytest.mark.parametrize(
    ("query", "expected_count"),
    [
        pytest.param("", 100, id="default-100"),
        pytest.param("?limit=1", 1, id="min"),
        pytest.param("?limit=200", 200, id="max"),
        pytest.param("?limit=7", 7, id="seven"),
    ],
)
def test_list_limit(
    client: TestClient, repo: InMemoryCommentRepo, query: str, expected_count: int
) -> None:
    _seed(repo, 210)
    response = client.get(f"{URL}{query}")
    assert response.status_code == 200
    assert len(response.json()["comments"]) == expected_count


@pytest.mark.parametrize("limit", ["0", "201", "-1", "abc"])
def test_list_limit_out_of_bounds(client: TestClient, limit: str) -> None:
    assert client.get(f"{URL}?limit={limit}").status_code == 422


def test_list_empty(client: TestClient) -> None:
    assert client.get(URL).json() == {"comments": []}


# --- expiry -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("age", "visible"),
    [
        pytest.param(timedelta(minutes=1), True, id="fresh"),
        pytest.param(COMMENT_TTL - timedelta(seconds=1), True, id="just-inside"),
        pytest.param(COMMENT_TTL + timedelta(seconds=1), False, id="just-expired"),
        pytest.param(timedelta(days=30), False, id="ancient"),
    ],
)
def test_expired_comments_are_hidden(
    client: TestClient, repo: InMemoryCommentRepo, age: timedelta, visible: bool
) -> None:
    repo.rows.append(
        Comment(
            id=1,
            post_slug="hello-world",
            color="#ff0000",
            text="old",
            created_at=repo.now - age,
        )
    )
    texts = [c["text"] for c in client.get(URL).json()["comments"]]
    assert ("old" in texts) is visible


def test_insert_sweeps_expired_rows(client: TestClient, repo: InMemoryCommentRepo) -> None:
    stale = Comment(
        id=1,
        post_slug="hello-world",
        color="#ff0000",
        text="old",
        created_at=datetime(2025, 1, 1, tzinfo=UTC),
    )
    repo.rows.append(stale)
    client.post(URL, json={"text": "new", "color": "#ff0000"})
    assert [c.text for c in repo.rows] == ["new"]
