from typing import NamedTuple

import httpx

from api.config import Settings

TIMEOUT_SECONDS = 5.0


class BoardResult(NamedTuple):
    ok: bool
    error: str | None
    status_code: int | None


def send_to_board(settings: Settings, token: str, text: str, color: str | None) -> BoardResult:
    """POST the message to the Pi with the caller's bearer token. Never raises."""
    url = f"{settings.ledboard_url.rstrip('/')}/text"
    try:
        response = httpx.post(
            url,
            json={"text": text, "color": color},
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
