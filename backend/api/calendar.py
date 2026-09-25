import json
import threading
import time
from datetime import date, datetime, timedelta
from datetime import time as clock
from typing import Any, Protocol
from urllib.parse import quote

import httpx
import jwt
from fastapi import HTTPException, Request, status
from pydantic import BaseModel

SCOPE = "https://www.googleapis.com/auth/calendar.events"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/calendar/v3"
TIMEZONE = "Europe/London"
TIMEOUT_SECONDS = 5.0
DEFAULT_LENGTH = timedelta(hours=1)


class CalendarEvent(BaseModel):
    id: str
    title: str
    # ISO dateTime with offset, or YYYY-MM-DD when all_day (end is exclusive, like Google)
    start: str
    end: str
    all_day: bool
    location: str | None
    link: str | None


class CalendarError(Exception):
    pass


def event_from_google(item: dict[str, Any]) -> CalendarEvent:
    start, end = item.get("start") or {}, item.get("end") or {}
    all_day = "date" in start
    key = "date" if all_day else "dateTime"
    return CalendarEvent(
        id=str(item["id"]),
        title=str(item.get("summary") or "").strip() or "(no title)",
        start=str(start[key]),
        end=str(end[key]),
        all_day=all_day,
        location=item.get("location") or None,
        link=item.get("htmlLink") or None,
    )


def google_times(
    day: date, start: clock | None, end: clock | None
) -> tuple[dict[str, str], dict[str, str]]:
    """Google start/end bodies. No start = all day; an end before the start runs past midnight."""
    if start is None:
        return {"date": day.isoformat()}, {"date": (day + timedelta(days=1)).isoformat()}
    begins = datetime.combine(day, start)
    if end is None:
        ends = begins + DEFAULT_LENGTH
    else:
        ends = datetime.combine(day, end)
        if ends <= begins:
            ends += timedelta(days=1)
    return (
        {"dateTime": begins.isoformat(), "timeZone": TIMEZONE},
        {"dateTime": ends.isoformat(), "timeZone": TIMEZONE},
    )


class Calendar(Protocol):
    def upcoming(self, limit: int) -> list[CalendarEvent]: ...

    def create(
        self,
        *,
        title: str,
        day: date,
        start: clock | None,
        end: clock | None,
        location: str | None,
        added_by: str,
    ) -> CalendarEvent: ...


class GoogleCalendar:
    """One calendar, as a service account it has been shared with ("Make changes to events")."""

    def __init__(self, calendar_id: str, service_account_json: str, api_url: str = API) -> None:
        self.calendar_id = calendar_id.strip()
        self._service_account_json = service_account_json
        self.api_url = api_url.rstrip("/")
        self._lock = threading.Lock()
        self._token = ""
        self._token_expires = 0.0

    def _access_token(self) -> str:
        with self._lock:
            now = time.time()
            if self._token and now < self._token_expires - 60:
                return self._token
            try:
                creds = json.loads(self._service_account_json)
                if not isinstance(creds, dict):
                    raise TypeError("not an object")
                token_url = creds.get("token_uri") or TOKEN_URL
                assertion = jwt.encode(
                    {
                        "iss": creds["client_email"],
                        "scope": SCOPE,
                        "aud": token_url,
                        "iat": int(now),
                        "exp": int(now) + 3600,
                    },
                    creds["private_key"],
                    algorithm="RS256",
                )
            except (ValueError, KeyError, TypeError, jwt.PyJWTError) as exc:
                raise CalendarError(f"bad service account json: {type(exc).__name__}") from exc
            body = self._send(
                "POST",
                token_url,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
            if "access_token" not in body:
                raise CalendarError("token response has no access_token")
            self._token = str(body["access_token"])
            self._token_expires = now + float(body.get("expires_in", 3600))
            return self._token

    def _send(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = httpx.request(method, url, timeout=TIMEOUT_SECONDS, **kwargs)
        except httpx.HTTPError as exc:
            raise CalendarError(f"{type(exc).__name__}: {exc}"[:500]) from exc
        if not response.is_success:
            raise CalendarError(f"google returned {response.status_code}: {response.text[:200]}")
        try:
            body = response.json()
        except ValueError as exc:
            raise CalendarError("google returned a non-json body") from exc
        if not isinstance(body, dict):
            raise CalendarError("google returned a non-object body")
        return body

    def _api(self, method: str, **kwargs: Any) -> dict[str, Any]:
        url = f"{self.api_url}/calendars/{quote(self.calendar_id, safe='')}/events"
        headers = {"Authorization": f"Bearer {self._access_token()}"}
        return self._send(method, url, headers=headers, **kwargs)

    def upcoming(self, limit: int) -> list[CalendarEvent]:
        body = self._api(
            "GET",
            params={
                "timeMin": datetime.now().astimezone().isoformat(),
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": limit,
            },
        )
        events = []
        for item in body.get("items") or []:
            if item.get("status") == "cancelled":
                continue
            try:
                events.append(event_from_google(item))
            except (KeyError, TypeError, AttributeError):
                continue  # one odd event shouldn't hide the rest
        return events

    def create(
        self,
        *,
        title: str,
        day: date,
        start: clock | None,
        end: clock | None,
        location: str | None,
        added_by: str,
    ) -> CalendarEvent:
        begins, ends = google_times(day, start, end)
        payload: dict[str, Any] = {
            "summary": title,
            "start": begins,
            "end": ends,
            "description": f"Added by {added_by or 'someone'} on home-dash",
        }
        if location:
            payload["location"] = location
        try:
            return event_from_google(self._api("POST", json=payload))
        except (KeyError, TypeError, AttributeError) as exc:
            raise CalendarError("google's created event is missing fields") from exc


def get_calendar(request: Request) -> Calendar:
    calendar: Calendar | None = request.app.state.calendar
    if calendar is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "calendar not configured: set GOOGLE_CALENDAR_ID and GOOGLE_SERVICE_ACCOUNT_JSON",
        )
    return calendar
