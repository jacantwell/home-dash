import json
import time
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from datetime import time as clock
from typing import Any
from urllib.parse import parse_qs

import httpx
import jwt
import pytest
import respx
from fastapi import FastAPI, HTTPException
from starlette.requests import Request

from api.calendar import (
    SCOPE,
    TIMEZONE,
    TOKEN_URL,
    CalendarError,
    CalendarEvent,
    GoogleCalendar,
    event_from_google,
    get_calendar,
    google_times,
)
from tests.fakes import InMemoryCalendar

API = "https://calendar.test/v3"
CALENDAR_ID = "house@group.calendar.google.com"
EVENTS_URL = f"{API}/calendars/house%40group.calendar.google.com/events"
SA_EMAIL = "home-dash@project.iam.gserviceaccount.com"
DAY = date(2026, 3, 14)
GOOGLE_ITEM = {
    "id": "abc",
    "summary": "Bins",
    "start": {"dateTime": "2026-03-14T09:00:00Z"},
    "end": {"dateTime": "2026-03-14T10:00:00Z"},
    "location": "Kerb",
    "htmlLink": "https://calendar.google.com/event?eid=abc",
}


def _sa_json(private_pem: bytes, **overrides: Any) -> str:
    creds = {
        "type": "service_account",
        "client_email": SA_EMAIL,
        "private_key": private_pem.decode(),
        **overrides,
    }
    return json.dumps({k: v for k, v in creds.items() if v is not None})


@pytest.fixture
def sa_json(rsa_keypair: tuple[bytes, Any]) -> str:
    return _sa_json(rsa_keypair[0])


@pytest.fixture
def google() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False) as router:
        router.post(TOKEN_URL).respond(200, json={"access_token": "tok", "expires_in": 3600})
        yield router


@pytest.fixture
def cal(sa_json: str) -> GoogleCalendar:
    return GoogleCalendar(CALENDAR_ID, sa_json, api_url=API)


# --- event_from_google ----------------------------------------------------------


def test_event_from_google_timed() -> None:
    assert event_from_google(GOOGLE_ITEM) == CalendarEvent(
        id="abc",
        title="Bins",
        start="2026-03-14T09:00:00Z",
        end="2026-03-14T10:00:00Z",
        all_day=False,
        location="Kerb",
        link="https://calendar.google.com/event?eid=abc",
    )


def test_event_from_google_all_day() -> None:
    item = {"id": "d", "summary": "Holiday", "start": {"date": "2026-03-14"}}
    item["end"] = {"date": "2026-03-15"}
    event = event_from_google(item)
    assert (event.start, event.end, event.all_day) == ("2026-03-14", "2026-03-15", True)


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"summary": None}, id="missing"),
        pytest.param({"summary": ""}, id="empty"),
        pytest.param({"summary": "   "}, id="blank"),
    ],
)
def test_event_from_google_untitled(overrides: dict[str, Any]) -> None:
    item = {k: v for k, v in {**GOOGLE_ITEM, **overrides}.items() if v is not None}
    assert event_from_google(item).title == "(no title)"


def test_event_from_google_strips_title() -> None:
    assert event_from_google({**GOOGLE_ITEM, "summary": "  Bins  "}).title == "Bins"


@pytest.mark.parametrize(
    ("key", "field"),
    [
        pytest.param("location", "location", id="location"),
        pytest.param("htmlLink", "link", id="link"),
    ],
)
@pytest.mark.parametrize("value", [None, ""], ids=["missing", "empty"])
def test_event_from_google_optional_fields_become_none(
    key: str, field: str, value: str | None
) -> None:
    item = {k: v for k, v in GOOGLE_ITEM.items() if k != key}
    if value is not None:
        item[key] = value
    assert getattr(event_from_google(item), field) is None


def test_event_from_google_stringifies_id() -> None:
    assert event_from_google({**GOOGLE_ITEM, "id": 42}).id == "42"


# --- google_times ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("day", "expected_end"),
    [
        pytest.param(date(2026, 3, 14), "2026-03-15", id="mid-month"),
        pytest.param(date(2026, 2, 28), "2026-03-01", id="month-end"),
        pytest.param(date(2026, 12, 31), "2027-01-01", id="year-end"),
    ],
)
def test_google_times_all_day(day: date, expected_end: str) -> None:
    start, end = google_times(day, None, None)
    assert start == {"date": day.isoformat()}
    assert end == {"date": expected_end}, "all-day end is exclusive: the next day"


def test_google_times_all_day_ignores_end() -> None:
    assert google_times(DAY, None, clock(10)) == google_times(DAY, None, None)


@pytest.mark.parametrize(
    ("start", "end", "expected_start", "expected_end"),
    [
        pytest.param(
            clock(9), None, "2026-03-14T09:00:00", "2026-03-14T10:00:00", id="default-hour"
        ),
        pytest.param(
            clock(23, 30),
            None,
            "2026-03-14T23:30:00",
            "2026-03-15T00:30:00",
            id="hour-past-midnight",
        ),
        pytest.param(
            clock(9), clock(11, 15), "2026-03-14T09:00:00", "2026-03-14T11:15:00", id="explicit-end"
        ),
        pytest.param(
            clock(22), clock(1), "2026-03-14T22:00:00", "2026-03-15T01:00:00", id="overnight"
        ),
        pytest.param(
            clock(9), clock(9), "2026-03-14T09:00:00", "2026-03-15T09:00:00", id="equal-rolls"
        ),
    ],
)
def test_google_times_timed(
    start: clock, end: clock | None, expected_start: str, expected_end: str
) -> None:
    begins, ends = google_times(DAY, start, end)
    assert begins == {"dateTime": expected_start, "timeZone": TIMEZONE}
    assert ends == {"dateTime": expected_end, "timeZone": TIMEZONE}


# --- access token ---------------------------------------------------------------


def _token_form(router: respx.MockRouter, call: int = -1) -> dict[str, str]:
    request = router.routes[0].calls[call].request
    return {k: v[0] for k, v in parse_qs(request.content.decode()).items()}


def test_token_request_is_signed_jwt_bearer_grant(
    cal: GoogleCalendar, google: respx.MockRouter, rsa_keypair: tuple[bytes, Any]
) -> None:
    assert cal._access_token() == "tok"
    form = _token_form(google)
    assert form["grant_type"] == "urn:ietf:params:oauth:grant-type:jwt-bearer"
    claims = jwt.decode(form["assertion"], rsa_keypair[1], algorithms=["RS256"], audience=TOKEN_URL)
    assert claims["iss"] == SA_EMAIL
    assert claims["scope"] == SCOPE
    assert claims["exp"] - claims["iat"] == 3600
    assert abs(claims["iat"] - time.time()) < 60


def test_token_uses_token_uri_from_json(rsa_keypair: tuple[bytes, Any]) -> None:
    custom = "https://oauth.test/token"
    cal = GoogleCalendar(CALENDAR_ID, _sa_json(rsa_keypair[0], token_uri=custom), api_url=API)
    with respx.mock() as router:
        route = router.post(custom).respond(200, json={"access_token": "t2"})
        assert cal._access_token() == "t2"
    assertion = parse_qs(route.calls.last.request.content.decode())["assertion"][0]
    claims = jwt.decode(assertion, rsa_keypair[1], algorithms=["RS256"], audience=custom)
    assert claims["aud"] == custom


def test_token_is_cached(cal: GoogleCalendar, google: respx.MockRouter) -> None:
    assert cal._access_token() == cal._access_token() == "tok"
    assert google.routes[0].call_count == 1, "second call should hit the cache"


@pytest.mark.parametrize(
    ("expires_in", "calls"),
    [
        pytest.param(3600, 1, id="fresh"),
        pytest.param(61, 1, id="just-outside-margin"),
        pytest.param(60, 2, id="inside-60s-margin"),
        pytest.param(0, 2, id="already-expired"),
    ],
)
def test_token_refreshes_within_60s_of_expiry(
    sa_json: str, expires_in: int, calls: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("api.calendar.time.time", lambda: 1_000_000.0)
    cal = GoogleCalendar(CALENDAR_ID, sa_json, api_url=API)
    with respx.mock() as router:
        route = router.post(TOKEN_URL).respond(
            200, json={"access_token": "tok", "expires_in": expires_in}
        )
        cal._access_token()
        cal._access_token()
    assert route.call_count == calls


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param("", id="empty"),
        pytest.param("{not json", id="bad-json"),
        pytest.param(json.dumps({"private_key": "x"}), id="no-client-email"),
        pytest.param(json.dumps({"client_email": SA_EMAIL}), id="no-private-key"),
    ],
)
def test_bad_service_account_json_is_calendar_error(raw: str) -> None:
    cal = GoogleCalendar(CALENDAR_ID, raw, api_url=API)
    with respx.mock() as router, pytest.raises(CalendarError, match="bad service account"):
        cal._access_token()
    assert router.calls.call_count == 0, "nothing should be sent with bad creds"


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(json.dumps({"client_email": SA_EMAIL, "private_key": "nope"}), id="bad-key"),
        pytest.param("[]", id="json-array"),
        pytest.param("null", id="json-null"),
        pytest.param('"str"', id="json-string"),
        pytest.param("1", id="json-number"),
    ],
)
def test_malformed_service_account_is_calendar_error(raw: str) -> None:
    cal = GoogleCalendar(CALENDAR_ID, raw, api_url=API)
    with respx.mock(), pytest.raises(CalendarError):
        cal._access_token()


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({}, id="empty"),
        pytest.param({"error": "invalid_grant"}, id="error-body"),
    ],
)
def test_token_response_without_access_token(cal: GoogleCalendar, body: dict) -> None:
    with respx.mock() as router, pytest.raises(CalendarError, match="no access_token"):
        router.post(TOKEN_URL).respond(200, json=body)
        cal._access_token()


def test_token_endpoint_failure_is_calendar_error(cal: GoogleCalendar) -> None:
    with respx.mock() as router, pytest.raises(CalendarError, match="400"):
        router.post(TOKEN_URL).respond(400, json={"error": "invalid_grant"})
        cal._access_token()


# --- _send ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("response", "match"),
    [
        pytest.param(httpx.Response(500, text="boom"), "500: boom", id="server-error"),
        pytest.param(httpx.Response(403, text="forbidden"), "403", id="forbidden"),
        pytest.param(httpx.Response(200, json=[1, 2]), "non-object", id="list-body"),
        pytest.param(httpx.Response(200, json="hi"), "non-object", id="string-body"),
        pytest.param(httpx.ConnectError("refused"), "ConnectError", id="connect-error"),
        pytest.param(httpx.ReadTimeout("slow"), "ReadTimeout", id="timeout"),
    ],
)
def test_send_failures_are_calendar_errors(
    cal: GoogleCalendar, response: httpx.Response | Exception, match: str
) -> None:
    with respx.mock() as router, pytest.raises(CalendarError, match=match):
        route = router.get(EVENTS_URL)
        if isinstance(response, Exception):
            route.side_effect = response
        else:
            route.return_value = response
        cal._send("GET", EVENTS_URL)


def test_send_truncates_error_text(cal: GoogleCalendar) -> None:
    with respx.mock() as router, pytest.raises(CalendarError) as info:
        router.get(EVENTS_URL).respond(500, text="x" * 1000)
        cal._send("GET", EVENTS_URL)
    assert len(str(info.value)) < 250


def test_send_non_json_success_is_calendar_error(cal: GoogleCalendar) -> None:
    with respx.mock() as router, pytest.raises(CalendarError):
        router.get(EVENTS_URL).respond(200, text="<html>oops</html>")
        cal._send("GET", EVENTS_URL)


def test_send_returns_body(cal: GoogleCalendar) -> None:
    with respx.mock() as router:
        router.get(EVENTS_URL).respond(200, json={"ok": True})
        assert cal._send("GET", EVENTS_URL) == {"ok": True}


# --- upcoming -------------------------------------------------------------------


def test_upcoming_request(cal: GoogleCalendar, google: respx.MockRouter) -> None:
    route = google.get(EVENTS_URL).respond(200, json={"items": []})
    cal.upcoming(7)
    request = route.calls.last.request
    params = dict(request.url.params)
    assert request.headers["Authorization"] == "Bearer tok"
    assert params["singleEvents"] == "true"
    assert params["orderBy"] == "startTime"
    assert params["maxResults"] == "7"
    time_min = datetime.fromisoformat(params["timeMin"])
    assert time_min.tzinfo is not None, "timeMin must carry an offset"
    assert abs(time_min - datetime.now().astimezone()) < timedelta(minutes=1)


def test_upcoming_percent_encodes_calendar_id(sa_json: str, google: respx.MockRouter) -> None:
    cal = GoogleCalendar("a/b c@x", sa_json, api_url=API + "/")
    route = google.get(f"{API}/calendars/a%2Fb%20c%40x/events").respond(200, json={})
    cal.upcoming(1)
    assert route.called


@pytest.mark.parametrize(
    ("body", "expected_ids"),
    [
        pytest.param({}, [], id="no-items-key"),
        pytest.param({"items": None}, [], id="null-items"),
        pytest.param({"items": [GOOGLE_ITEM]}, ["abc"], id="one"),
        pytest.param(
            {
                "items": [
                    {**GOOGLE_ITEM, "id": "a"},
                    {**GOOGLE_ITEM, "id": "b", "status": "cancelled"},
                    {**GOOGLE_ITEM, "id": "c", "status": "confirmed"},
                ]
            },
            ["a", "c"],
            id="drops-cancelled",
        ),
    ],
)
def test_upcoming_parses_items(
    cal: GoogleCalendar, google: respx.MockRouter, body: dict, expected_ids: list[str]
) -> None:
    google.get(EVENTS_URL).respond(200, json=body)
    assert [e.id for e in cal.upcoming(20)] == expected_ids


def _without(key: str) -> dict[str, Any]:
    return {k: v for k, v in GOOGLE_ITEM.items() if k != key}


UNPARSEABLE = [
    pytest.param(_without("start"), id="missing-start"),
    pytest.param(_without("end"), id="missing-end"),
    pytest.param(_without("id"), id="missing-id"),
    pytest.param({**GOOGLE_ITEM, "start": {"date": "2026-03-14"}}, id="all-day-start-timed-end"),
    pytest.param({**GOOGLE_ITEM, "end": {"date": "2026-03-15"}}, id="timed-start-all-day-end"),
    pytest.param({**GOOGLE_ITEM, "start": "2026-03-14"}, id="non-dict-start"),
    pytest.param({**GOOGLE_ITEM, "end": ["2026-03-14"]}, id="non-dict-end"),
]


@pytest.mark.parametrize("bad", UNPARSEABLE)
def test_upcoming_skips_unparseable_items(
    cal: GoogleCalendar, google: respx.MockRouter, bad: dict[str, Any]
) -> None:
    items = [{**GOOGLE_ITEM, "id": "before"}, bad, {**GOOGLE_ITEM, "id": "after"}]
    google.get(EVENTS_URL).respond(200, json={"items": items})
    assert [e.id for e in cal.upcoming(20)] == ["before", "after"], (
        "bad item should be dropped, neighbours kept"
    )


def test_upcoming_api_error(cal: GoogleCalendar, google: respx.MockRouter) -> None:
    google.get(EVENTS_URL).respond(404, text="not found")
    with pytest.raises(CalendarError, match="404"):
        cal.upcoming(20)


# --- create ---------------------------------------------------------------------


def _create(cal: GoogleCalendar, **overrides: Any) -> CalendarEvent:
    kwargs: dict[str, Any] = {
        "title": "Bins",
        "day": DAY,
        "start": clock(9),
        "end": None,
        "location": None,
        "added_by": "Jasper",
        **overrides,
    }
    return cal.create(**kwargs)


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        pytest.param(
            {},
            {
                "summary": "Bins",
                "start": {"dateTime": "2026-03-14T09:00:00", "timeZone": TIMEZONE},
                "end": {"dateTime": "2026-03-14T10:00:00", "timeZone": TIMEZONE},
                "description": "Added by Jasper on home-dash",
            },
            id="timed-no-location",
        ),
        pytest.param(
            {"start": None, "location": "Kerb", "added_by": ""},
            {
                "summary": "Bins",
                "start": {"date": "2026-03-14"},
                "end": {"date": "2026-03-15"},
                "description": "Added by someone on home-dash",
                "location": "Kerb",
            },
            id="all-day-with-location-anonymous",
        ),
        pytest.param(
            {"location": ""},
            {
                "summary": "Bins",
                "start": {"dateTime": "2026-03-14T09:00:00", "timeZone": TIMEZONE},
                "end": {"dateTime": "2026-03-14T10:00:00", "timeZone": TIMEZONE},
                "description": "Added by Jasper on home-dash",
            },
            id="empty-location-omitted",
        ),
    ],
)
def test_create_payload(
    cal: GoogleCalendar, google: respx.MockRouter, overrides: dict, expected: dict
) -> None:
    route = google.post(EVENTS_URL).respond(200, json=GOOGLE_ITEM)
    _create(cal, **overrides)
    request = route.calls.last.request
    assert request.headers["Authorization"] == "Bearer tok"
    assert json.loads(request.content) == expected


def test_create_returns_parsed_event(cal: GoogleCalendar, google: respx.MockRouter) -> None:
    google.post(EVENTS_URL).respond(200, json=GOOGLE_ITEM)
    assert _create(cal) == event_from_google(GOOGLE_ITEM)


def test_create_reuses_token(cal: GoogleCalendar, google: respx.MockRouter) -> None:
    google.post(EVENTS_URL).respond(200, json=GOOGLE_ITEM)
    _create(cal)
    _create(cal)
    assert google.routes[0].call_count == 1


@pytest.mark.parametrize("bad", UNPARSEABLE + [pytest.param({}, id="empty-object")])
def test_create_unparseable_response_is_calendar_error(
    cal: GoogleCalendar, google: respx.MockRouter, bad: dict[str, Any]
) -> None:
    google.post(EVENTS_URL).respond(200, json=bad)
    with pytest.raises(CalendarError, match="missing fields"):
        _create(cal)


def test_create_api_error(cal: GoogleCalendar, google: respx.MockRouter) -> None:
    google.post(EVENTS_URL).respond(403, text="forbidden")
    with pytest.raises(CalendarError, match="403"):
        _create(cal)


# --- get_calendar ---------------------------------------------------------------


def _request(calendar: Any) -> Request:
    app = FastAPI()
    app.state.calendar = calendar
    return Request({"type": "http", "app": app})


def test_get_calendar_returns_configured() -> None:
    fake = InMemoryCalendar()
    assert get_calendar(_request(fake)) is fake


def test_get_calendar_unconfigured_is_503() -> None:
    with pytest.raises(HTTPException) as info:
        get_calendar(_request(None))
    assert info.value.status_code == 503
