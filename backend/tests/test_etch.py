import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from api.app import create_app
from api.board import etch_clear, etch_move, etch_state
from api.config import Settings
from tests.conftest import ORIGIN

STATE = {"w": 128, "h": 32, "x": 64, "y": 16, "lit": 1, "pixels_b64": "AAA="}
FRONTEND = {"Origin": ORIGIN}
FOREIGN = {"Origin": "https://evil.example"}


@pytest.fixture
def board() -> respx.MockRouter:
    with respx.mock(assert_all_called=False) as router:
        yield router


@pytest.fixture
def open_client() -> TestClient:
    """No authorized parties configured: the origin check is skipped."""
    settings = Settings(
        _env_file=None,
        database_url="",
        ledboard_url="http://ledboard.test",
        clerk_issuer="https://clean-dinosaur-8235.clerk.accounts.dev",
        clerk_authorized_parties="",
    )
    return TestClient(create_app(settings, verifier=None))


# --- board helpers ------------------------------------------------------------


@respx.mock
def test_etch_state_sends_no_auth_header_without_a_token(settings: Settings) -> None:
    route = respx.get("http://ledboard.test/etch").respond(200, json=STATE)
    result = etch_state(settings)
    assert result.ok is True
    assert result.body == STATE
    assert "authorization" not in route.calls.last.request.headers


@respx.mock
def test_etch_state_forwards_a_token_when_given(settings: Settings) -> None:
    route = respx.get("http://ledboard.test/etch").respond(200, json=STATE)
    assert etch_state(settings, token="tok").ok is True
    assert route.calls.last.request.headers["Authorization"] == "Bearer tok"


@respx.mock
def test_etch_move_posts_the_nudge(settings: Settings) -> None:
    route = respx.post("http://ledboard.test/etch/move").respond(200, json={"x": 68, "y": 16})
    result = etch_move(settings, 4, 0)
    assert result == (True, None, 200, {"x": 68, "y": 16})
    assert route.calls.last.request.read() == b'{"dx":4,"dy":0}'


@respx.mock
def test_etch_helpers_forward_origin_headers(settings: Settings) -> None:
    route = respx.get("http://ledboard.test/etch").respond(200, json=STATE)
    etch_state(settings, headers={"origin": ORIGIN})
    assert route.calls.last.request.headers["origin"] == ORIGIN


@respx.mock
def test_etch_clear_posts_empty(settings: Settings) -> None:
    respx.post("http://ledboard.test/etch/clear").respond(200, json={"cleared": True})
    assert etch_clear(settings).body == {"cleared": True}


@pytest.mark.parametrize(
    ("side_effect", "error_match", "status"),
    [
        pytest.param(httpx.Response(503, text="no etch"), "ledboard returned 503: no etch", 503),
        pytest.param(httpx.Response(422, text="noop"), "ledboard returned 422: noop", 422),
        pytest.param(httpx.TimeoutException("slow"), "TimeoutException: slow", None, id="timeout"),
        pytest.param(httpx.ConnectError("nope"), "ConnectError: nope", None, id="connect"),
    ],
)
@respx.mock
def test_etch_failures_never_raise(
    settings: Settings, side_effect: object, error_match: str, status: int | None
) -> None:
    respx.get("http://ledboard.test/etch").mock(side_effect=side_effect)
    result = etch_state(settings)
    assert result.ok is False
    assert result.error == error_match
    assert result.status_code == status


# --- routes -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("GET", "/api/etch", None),
        ("POST", "/api/etch/move", {"dx": 1}),
        ("POST", "/api/etch/clear", None),
    ],
)
def test_etch_is_anonymous(
    client: TestClient, board: respx.MockRouter, method: str, path: str, payload: dict | None
) -> None:
    """No login needed: a frontend Origin is the only credential."""
    pi_path = "http://ledboard.test" + path.removeprefix("/api")
    board.request(method, pi_path).respond(200, json=STATE)
    response = client.request(method, path, json=payload, headers=FRONTEND)
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("GET", "/api/etch", None),
        ("POST", "/api/etch/move", {"dx": 1}),
        ("POST", "/api/etch/clear", None),
    ],
)
def test_etch_rejects_requests_without_a_frontend_origin(
    client: TestClient, board: respx.MockRouter, method: str, path: str, payload: dict | None
) -> None:
    response = client.request(method, path, json=payload)
    assert response.status_code == 403
    assert not board.calls, "blocked requests never reach the Pi"


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("GET", "/api/etch", None),
        ("POST", "/api/etch/move", {"dx": 1}),
        ("POST", "/api/etch/clear", None),
    ],
)
def test_etch_rejects_a_foreign_origin(
    client: TestClient, board: respx.MockRouter, method: str, path: str, payload: dict | None
) -> None:
    response = client.request(method, path, json=payload, headers=FOREIGN)
    assert response.status_code == 403
    assert not board.calls, "blocked requests never reach the Pi"


def test_etch_accepts_a_frontend_referer(client: TestClient, board: respx.MockRouter) -> None:
    board.get("http://ledboard.test/etch").respond(200, json=STATE)
    response = client.get("/api/etch", headers={"Referer": f"{ORIGIN}/etch"})
    assert response.status_code == 200, response.text
    assert response.json() == STATE


def test_etch_is_open_without_configured_parties(
    open_client: TestClient, board: respx.MockRouter
) -> None:
    board.get("http://ledboard.test/etch").respond(200, json=STATE)
    assert open_client.get("/api/etch").status_code == 200


def test_get_etch_returns_the_pi_state(client: TestClient, board: respx.MockRouter) -> None:
    route = board.get("http://ledboard.test/etch").respond(200, json=STATE)
    response = client.get("/api/etch", headers=FRONTEND)
    assert response.status_code == 200, response.text
    assert response.json() == STATE
    last = route.calls.last.request
    assert last.headers["origin"] == ORIGIN, "the browser origin rides along to the Pi"
    assert "authorization" not in last.headers, "no login means no token to forward"


def test_post_move_returns_the_new_cursor(client: TestClient, board: respx.MockRouter) -> None:
    route = board.post("http://ledboard.test/etch/move").respond(200, json={"x": 68, "y": 16})
    response = client.post("/api/etch/move", json={"dx": 4, "dy": 0}, headers=FRONTEND)
    assert response.status_code == 200, response.text
    assert response.json() == {"x": 68, "y": 16}
    assert route.calls.last.request.read() == b'{"dx":4,"dy":0}'


def test_post_clear_shakes(client: TestClient, board: respx.MockRouter) -> None:
    board.post("http://ledboard.test/etch/clear").respond(
        200, json={"cleared": True, "x": 1, "y": 2}
    )
    response = client.post("/api/etch/clear", headers=FRONTEND)
    assert response.status_code == 200, response.text
    assert response.json() == {"cleared": True, "x": 1, "y": 2}


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"dx": 33, "dy": 0}, id="dx-over-max"),
        pytest.param({"dx": 0, "dy": -33}, id="dy-under-min"),
        pytest.param({"dx": 0, "dy": 0}, id="noop"),
        pytest.param({"dx": "far"}, id="not-a-number"),
    ],
)
def test_post_move_rejects_bad_nudges(
    client: TestClient, board: respx.MockRouter, body: dict
) -> None:
    response = client.post("/api/etch/move", json=body, headers=FRONTEND)
    assert response.status_code == 422, f"{body!r} is not a knob nudge"
    assert not board.calls, "invalid input never reaches the Pi"


def test_unreachable_pi_is_502(client: TestClient, board: respx.MockRouter) -> None:
    board.get("http://ledboard.test/etch").mock(side_effect=httpx.ConnectError("nope"))
    response = client.get("/api/etch", headers=FRONTEND)
    assert response.status_code == 502
    assert "ConnectError" in response.json()["detail"]


def test_disabled_etch_app_passes_through(client: TestClient, board: respx.MockRouter) -> None:
    board.get("http://ledboard.test/etch").respond(503, text="etch app is not enabled")
    response = client.get("/api/etch", headers=FRONTEND)
    assert response.status_code == 503
    assert "ledboard returned 503" in response.json()["detail"]
