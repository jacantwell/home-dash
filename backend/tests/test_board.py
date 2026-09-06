import httpx
import pytest
import respx

from api.board import send_to_board
from api.config import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, ledboard_url="http://ledboard.test/")


@pytest.mark.parametrize("status", [200, 202, 204])
@respx.mock
def test_send_ok(settings: Settings, status: int) -> None:
    route = respx.post("http://ledboard.test/text").respond(status)
    result = send_to_board(settings, "tok", "hi", None)
    assert result == (True, None, status)
    assert route.calls.last.request.headers["Authorization"] == "Bearer tok"
    assert route.calls.last.request.read() == b'{"text":"hi","color":null}'


@pytest.mark.parametrize(
    ("side_effect", "error_match", "status"),
    [
        pytest.param(
            httpx.Response(500, text="boom"), "ledboard returned 500: boom", 500, id="500"
        ),
        pytest.param(httpx.Response(429), "ledboard returned 429", 429, id="429"),
        pytest.param(httpx.TimeoutException("slow"), "TimeoutException: slow", None, id="timeout"),
        pytest.param(httpx.ConnectError("nope"), "ConnectError: nope", None, id="connect"),
    ],
)
@respx.mock
def test_send_failures_never_raise(
    settings: Settings, side_effect: object, error_match: str, status: int | None
) -> None:
    respx.post("http://ledboard.test/text").mock(side_effect=side_effect)
    result = send_to_board(settings, "tok", "hi", "#ffffff")
    assert result.ok is False
    assert result.error == error_match
    assert result.status_code == status
