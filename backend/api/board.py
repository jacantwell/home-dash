from typing import Any, NamedTuple

import httpx

from api.config import Settings

TIMEOUT_SECONDS = 5.0


class BoardResult(NamedTuple):
    ok: bool
    error: str | None
    status_code: int | None


def send_to_board(
    settings: Settings, token: str, text: str, color: str | None, duration_s: int | None = None
) -> BoardResult:
    """POST the message to the Pi with the caller's bearer token. Never raises."""
    url = f"{settings.ledboard_url.rstrip('/')}/text"
    try:
        response = httpx.post(
            url,
            json={"text": text, "color": color, "duration_s": duration_s},
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        return BoardResult(False, f"{type(exc).__name__}: {exc}"[:500] or type(exc).__name__, None)
    if response.is_success:
        return BoardResult(True, None, response.status_code)
    body = response.text.strip()[:200]
    detail = f"ledboard returned {response.status_code}"
    return BoardResult(False, f"{detail}: {body}" if body else detail, response.status_code)


class EtchResult(NamedTuple):
    ok: bool
    error: str | None
    status_code: int | None
    body: dict[str, Any]


def call_board(
    settings: Settings,
    token: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> EtchResult:
    """Call the Pi with the caller's bearer token. Never raises; body is the Pi's JSON."""
    url = f"{settings.ledboard_url.rstrip('/')}{path}"
    try:
        response = httpx.request(
            method,
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        reason = f"{type(exc).__name__}: {exc}"[:500] or type(exc).__name__
        return EtchResult(False, reason, None, {})
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.is_success:
        return EtchResult(True, None, response.status_code, body if isinstance(body, dict) else {})
    detail = f"ledboard returned {response.status_code}"
    text = response.text.strip()[:200]
    return EtchResult(False, f"{detail}: {text}" if text else detail, response.status_code, {})


def etch_state(settings: Settings, token: str) -> EtchResult:
    """Fetch the sketch buffer (cursor, lit count, packed bitmap)."""
    return call_board(settings, token, "GET", "/etch")


def etch_move(settings: Settings, token: str, dx: int, dy: int) -> EtchResult:
    """Nudge the stylus; the Pi draws the line and echoes the new cursor."""
    return call_board(settings, token, "POST", "/etch/move", {"dx": dx, "dy": dy})


def etch_clear(settings: Settings, token: str) -> EtchResult:
    """Shake: wipe the screen, stylus stays where it was."""
    return call_board(settings, token, "POST", "/etch/clear")
