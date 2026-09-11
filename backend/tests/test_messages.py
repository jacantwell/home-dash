import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from api.app import create_app
from api.auth import ClerkVerifier
from api.config import Settings
from api.db import get_repo
from tests.conftest import TokenFactory
from tests.fakes import InMemoryRepo

BOARD_TEXT_URL = "http://ledboard.test/text"


@pytest.fixture
def repo() -> InMemoryRepo:
    return InMemoryRepo()


@pytest.fixture
def client(settings: Settings, verifier: ClerkVerifier, repo: InMemoryRepo) -> TestClient:
    app = create_app(settings, verifier=verifier)
    app.dependency_overrides[get_repo] = lambda: repo
    return TestClient(app)


@pytest.fixture
def auth(make_token: TokenFactory) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(name='Jasper')}"}


@pytest.fixture
def board() -> respx.MockRouter:
    with respx.mock(assert_all_called=False) as router:
        yield router


# --- auth ---------------------------------------------------------------------


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_messages_require_token(client: TestClient, method: str) -> None:
    response = client.request(method, "/api/messages", json={"text": "hi"})
    assert response.status_code == 401
    assert "missing" in response.json()["detail"]
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    ("headers", "match"),
    [
        pytest.param({"Authorization": "Basic abc"}, "missing", id="wrong-scheme"),
        pytest.param({"Authorization": "Bearer "}, "missing", id="empty-bearer"),
        pytest.param({"Authorization": "Bearer not.a.jwt"}, "invalid token", id="garbage"),
    ],
)
def test_messages_reject_malformed_auth(
    client: TestClient, headers: dict[str, str], match: str
) -> None:
    response = client.get("/api/messages", headers=headers)
    assert response.status_code == 401
    assert match in response.json()["detail"]


@pytest.mark.parametrize(
    ("token_kwargs", "match"),
    [
        pytest.param({"exp_delta": -60}, "expired", id="expired"),
        pytest.param({"azp": "http://evil.example"}, "azp", id="bad-azp"),
        pytest.param({"iss": "https://evil.example"}, "issuer", id="wrong-issuer"),
    ],
)
def test_messages_reject_bad_tokens(
    client: TestClient,
    make_token: TokenFactory,
    repo: InMemoryRepo,
    board: respx.MockRouter,
    token_kwargs: dict,
    match: str,
) -> None:
    headers = {"Authorization": f"Bearer {make_token(**token_kwargs)}"}
    response = client.post("/api/messages", json={"text": "hi"}, headers=headers)
    assert response.status_code == 401
    assert match in response.json()["detail"]
    assert repo.rows == []
    assert not board.calls


def test_unconfigured_auth_is_503(settings: Settings) -> None:
    unconfigured = TestClient(create_app(settings.model_copy(update={"clerk_issuer": ""})))
    response = unconfigured.get("/api/messages", headers={"Authorization": "Bearer x"})
    assert response.status_code == 503
    assert unconfigured.get("/api/healthz").status_code == 200


# --- validation -----------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({}, id="no-text"),
        pytest.param({"text": ""}, id="empty"),
        pytest.param({"text": "   \n\t "}, id="whitespace-only"),
        pytest.param({"text": "x" * 201}, id="too-long"),
        pytest.param({"text": 123}, id="not-a-string"),
        pytest.param({"text": "hi", "color": "red"}, id="color-name"),
        pytest.param({"text": "hi", "color": "#fff"}, id="color-short"),
        pytest.param({"text": "hi", "color": "#gggggg"}, id="color-not-hex"),
        pytest.param({"text": "hi", "color": "ff00ff"}, id="color-no-hash"),
        pytest.param({"text": "hi", "duration_s": 0}, id="duration-zero"),
        pytest.param({"text": "hi", "duration_s": -5}, id="duration-negative"),
        pytest.param({"text": "hi", "duration_s": 61}, id="duration-over-max"),
        pytest.param({"text": "hi", "duration_s": 2.5}, id="duration-fractional"),
        pytest.param({"text": "hi", "duration_s": "ten"}, id="duration-not-a-number"),
    ],
)
def test_post_rejects_bad_body(
    client: TestClient,
    auth: dict[str, str],
    repo: InMemoryRepo,
    board: respx.MockRouter,
    body: dict,
) -> None:
    response = client.post("/api/messages", json=body, headers=auth)
    assert response.status_code == 422
    assert repo.rows == []
    assert not board.calls


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  hello   world \n", "hello world"),
        ("x" * 200, "x" * 200),
        (" " + "x" * 200 + " ", "x" * 200),
    ],
)
def test_post_normalises_text(
    client: TestClient, auth: dict[str, str], board: respx.MockRouter, raw: str, expected: str
) -> None:
    board.post(BOARD_TEXT_URL).respond(202)
    response = client.post("/api/messages", json={"text": raw}, headers=auth)
    assert response.status_code == 202
    assert response.json()["text"] == expected


@pytest.mark.parametrize(
    ("color", "expected"),
    [(None, None), ("", None), ("#FF00aa", "#ff00aa"), ("#00ff00", "#00ff00")],
)
def test_post_normalises_color(
    client: TestClient,
    auth: dict[str, str],
    board: respx.MockRouter,
    color: str | None,
    expected: str | None,
) -> None:
    board.post(BOARD_TEXT_URL).respond(202)
    response = client.post("/api/messages", json={"text": "hi", "color": color}, headers=auth)
    assert response.status_code == 202
    assert response.json()["color"] == expected


@pytest.mark.parametrize("duration", [None, 1, 30, 60])
def test_post_stores_and_forwards_duration(
    client: TestClient,
    auth: dict[str, str],
    repo: InMemoryRepo,
    board: respx.MockRouter,
    duration: int | None,
) -> None:
    route = board.post(BOARD_TEXT_URL).respond(202)
    body = {"text": "hi"} if duration is None else {"text": "hi", "duration_s": duration}
    response = client.post("/api/messages", json=body, headers=auth)

    assert response.status_code == 202
    assert response.json()["duration_s"] == duration
    assert repo.rows[0].duration_s == duration
    assert json.loads(route.calls.last.request.content)["duration_s"] == duration


# --- board forwarding -------------------------------------------------------------


@pytest.mark.parametrize("board_status", [200, 202, 204])
def test_post_sent_when_board_accepts(
    client: TestClient,
    auth: dict[str, str],
    make_token: TokenFactory,
    repo: InMemoryRepo,
    board: respx.MockRouter,
    board_status: int,
) -> None:
    route = board.post(BOARD_TEXT_URL).respond(board_status)
    response = client.post(
        "/api/messages", json={"text": "hello", "color": "#ff0000"}, headers=auth
    )

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "sent"
    assert body["error"] is None
    assert body["sender_name"] == "Jasper"
    assert body["text"] == "hello"
    assert body["color"] == "#ff0000"
    assert isinstance(body["id"], int)
    assert body["created_at"].startswith("2026-01-01T")
    assert len(repo.rows) == 1

    request = route.calls.last.request
    assert request.headers["Authorization"] == auth["Authorization"]
    assert request.content == b'{"text":"hello","color":"#ff0000","duration_s":null}'


@pytest.mark.parametrize(
    ("side_effect", "error_match"),
    [
        pytest.param(httpx.Response(500, text="boom"), "ledboard returned 500: boom", id="500"),
        pytest.param(httpx.Response(404), "ledboard returned 404", id="404-no-body"),
        pytest.param(httpx.Response(401, json={"detail": "nope"}), "401", id="401"),
        pytest.param(httpx.TimeoutException("timed out"), "TimeoutException", id="timeout"),
        pytest.param(httpx.ConnectError("refused"), "ConnectError", id="connect-error"),
    ],
)
def test_post_failed_when_board_errors(
    client: TestClient,
    auth: dict[str, str],
    repo: InMemoryRepo,
    board: respx.MockRouter,
    side_effect: object,
    error_match: str,
) -> None:
    board.post(BOARD_TEXT_URL).mock(side_effect=side_effect)
    response = client.post("/api/messages", json={"text": "hello"}, headers=auth)

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "failed"
    assert error_match in body["error"]
    assert repo.rows[0].status == "failed"


def test_post_passes_through_board_429(
    client: TestClient, auth: dict[str, str], repo: InMemoryRepo, board: respx.MockRouter
) -> None:
    board.post(BOARD_TEXT_URL).respond(429)
    response = client.post("/api/messages", json={"text": "hello"}, headers=auth)
    assert response.status_code == 429
    assert repo.rows[0].status == "failed"
    assert "429" in repo.rows[0].error


def test_sender_name_blank_without_name_claim(
    client: TestClient, make_token: TokenFactory, board: respx.MockRouter
) -> None:
    board.post(BOARD_TEXT_URL).respond(202)
    headers = {"Authorization": f"Bearer {make_token(sub='user_xyz')}"}
    response = client.post("/api/messages", json={"text": "hello"}, headers=headers)
    assert response.json()["sender_name"] == ""


# --- listing ------------------------------------------------------------------------


def _seed(repo: InMemoryRepo, n: int) -> None:
    for i in range(n):
        repo.insert(
            clerk_user_id="u",
            sender_name="s",
            text=f"msg {i}",
            color=None,
            status="sent",
            error=None,
        )


def test_list_newest_first(client: TestClient, auth: dict[str, str], repo: InMemoryRepo) -> None:
    _seed(repo, 3)
    response = client.get("/api/messages", headers=auth)
    assert response.status_code == 200
    assert [m["text"] for m in response.json()["messages"]] == ["msg 2", "msg 1", "msg 0"]


@pytest.mark.parametrize(
    ("query", "expected_count"),
    [
        pytest.param("", 20, id="default-20"),
        pytest.param("?limit=1", 1, id="min"),
        pytest.param("?limit=100", 100, id="max"),
        pytest.param("?limit=5", 5, id="five"),
    ],
)
def test_list_limit(
    client: TestClient, auth: dict[str, str], repo: InMemoryRepo, query: str, expected_count: int
) -> None:
    _seed(repo, 120)
    response = client.get(f"/api/messages{query}", headers=auth)
    assert response.status_code == 200
    assert len(response.json()["messages"]) == expected_count


@pytest.mark.parametrize("limit", ["0", "101", "-1", "abc"])
def test_list_limit_out_of_bounds(client: TestClient, auth: dict[str, str], limit: str) -> None:
    response = client.get(f"/api/messages?limit={limit}", headers=auth)
    assert response.status_code == 422


def test_list_empty(client: TestClient, auth: dict[str, str]) -> None:
    assert client.get("/api/messages", headers=auth).json() == {"messages": []}
