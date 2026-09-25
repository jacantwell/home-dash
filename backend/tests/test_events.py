from datetime import UTC, date, datetime, timedelta
from datetime import time as clock
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.auth import ClerkVerifier
from api.calendar import CalendarEvent, GoogleCalendar
from api.config import Settings
from tests.conftest import TokenFactory
from tests.fakes import InMemoryCalendar

URL = "/api/events"
UTC_TODAY = datetime.now(UTC).date()
SOON = UTC_TODAY + timedelta(days=7)


def _event(i: int) -> CalendarEvent:
    day = (SOON + timedelta(days=i)).isoformat()
    return CalendarEvent(
        id=f"e{i}",
        title=f"event {i}",
        start=day,
        end=day,
        all_day=True,
        location=None,
        link=None,
    )


@pytest.fixture
def calendar() -> InMemoryCalendar:
    return InMemoryCalendar()


@pytest.fixture
def client(settings: Settings, verifier: ClerkVerifier, calendar: InMemoryCalendar) -> TestClient:
    return TestClient(create_app(settings, verifier=verifier, calendar=calendar))


@pytest.fixture
def auth(make_token: TokenFactory) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(name='Jasper')}"}


def _body(**overrides: Any) -> dict:
    return {"title": "Bins", "date": SOON.isoformat(), **overrides}


# --- auth / config --------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "body"),
    [pytest.param("GET", None, id="list"), pytest.param("POST", _body(), id="create")],
)
def test_requires_token(
    client: TestClient, calendar: InMemoryCalendar, method: str, body: dict | None
) -> None:
    assert client.request(method, URL, json=body).status_code == 401
    assert calendar.created == []
    assert calendar.limits == []


@pytest.mark.parametrize(
    ("method", "body"),
    [pytest.param("GET", None, id="list"), pytest.param("POST", _body(), id="create")],
)
def test_rejects_expired_token(
    client: TestClient,
    make_token: TokenFactory,
    calendar: InMemoryCalendar,
    method: str,
    body: dict | None,
) -> None:
    headers = {"Authorization": f"Bearer {make_token(exp_delta=-120)}"}
    assert client.request(method, URL, json=body, headers=headers).status_code == 401
    assert calendar.created == []


@pytest.mark.parametrize(
    ("method", "body"),
    [pytest.param("GET", None, id="list"), pytest.param("POST", _body(), id="create")],
)
def test_unconfigured_calendar_is_503(
    settings: Settings,
    verifier: ClerkVerifier,
    auth: dict[str, str],
    method: str,
    body: dict | None,
) -> None:
    client = TestClient(create_app(settings, verifier=verifier))
    response = client.request(method, URL, json=body, headers=auth)
    assert response.status_code == 503
    assert "GOOGLE_CALENDAR_ID" in response.json()["detail"]


@pytest.mark.parametrize(
    ("calendar_id", "sa_json", "configured"),
    [
        pytest.param("", "", False, id="neither"),
        pytest.param("house@x", "", False, id="id-only"),
        pytest.param("", "{}", False, id="json-only"),
        pytest.param("house@x", "{}", True, id="both"),
    ],
)
def test_create_app_builds_google_calendar_only_when_fully_configured(
    settings: Settings, calendar_id: str, sa_json: str, configured: bool
) -> None:
    settings = settings.model_copy(
        update={"google_calendar_id": calendar_id, "google_service_account_json": sa_json}
    )
    calendar = create_app(settings).state.calendar
    assert isinstance(calendar, GoogleCalendar) is configured
    if configured:
        assert calendar.calendar_id == "house@x"


def test_create_app_prefers_injected_calendar(settings: Settings) -> None:
    settings = settings.model_copy(
        update={"google_calendar_id": "house@x", "google_service_account_json": "{}"}
    )
    fake = InMemoryCalendar()
    assert create_app(settings, calendar=fake).state.calendar is fake


# --- listing --------------------------------------------------------------------


def test_list_returns_events(
    client: TestClient, auth: dict[str, str], calendar: InMemoryCalendar
) -> None:
    calendar.events = [_event(0), _event(1)]
    response = client.get(URL, headers=auth)
    assert response.status_code == 200
    assert response.json() == {"events": [e.model_dump() for e in calendar.events]}


def test_list_empty(client: TestClient, auth: dict[str, str]) -> None:
    assert client.get(URL, headers=auth).json() == {"events": []}


@pytest.mark.parametrize(
    ("query", "expected_limit"),
    [
        pytest.param("", 20, id="default-20"),
        pytest.param("?limit=1", 1, id="min"),
        pytest.param("?limit=100", 100, id="max"),
        pytest.param("?limit=7", 7, id="seven"),
    ],
)
def test_list_limit_passed_through(
    client: TestClient,
    auth: dict[str, str],
    calendar: InMemoryCalendar,
    query: str,
    expected_limit: int,
) -> None:
    assert client.get(f"{URL}{query}", headers=auth).status_code == 200
    assert calendar.limits == [expected_limit]


@pytest.mark.parametrize("limit", ["0", "101", "-1", "abc"])
def test_list_limit_out_of_bounds(
    client: TestClient, auth: dict[str, str], calendar: InMemoryCalendar, limit: str
) -> None:
    assert client.get(f"{URL}?limit={limit}", headers=auth).status_code == 422
    assert calendar.limits == []


# --- create validation ----------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({}, id="empty-body"),
        pytest.param({"date": SOON.isoformat()}, id="no-title"),
        pytest.param({"title": "Bins"}, id="no-date"),
        pytest.param(_body(title=""), id="empty-title"),
        pytest.param(_body(title=" \t\n "), id="blank-title"),
        pytest.param(_body(title="x" * 101), id="title-too-long"),
        pytest.param(_body(date="not-a-date"), id="bad-date"),
        pytest.param(_body(date=(UTC_TODAY - timedelta(days=2)).isoformat()), id="past-date"),
        pytest.param(_body(start_time="25:00"), id="bad-start"),
        pytest.param(_body(start_time="nine"), id="garbage-start"),
        pytest.param(_body(start_time="09:00", end_time="24:30"), id="bad-end"),
        pytest.param(_body(end_time="10:00"), id="end-without-start"),
        pytest.param(_body(location="x" * 201), id="location-too-long"),
    ],
)
def test_create_rejects_bad_body(
    client: TestClient, auth: dict[str, str], calendar: InMemoryCalendar, body: dict
) -> None:
    assert client.post(URL, json=body, headers=auth).status_code == 422
    assert calendar.created == []


@pytest.mark.parametrize(
    "day",
    [
        pytest.param(UTC_TODAY - timedelta(days=1), id="yesterday-utc-slack"),
        pytest.param(UTC_TODAY, id="today"),
        pytest.param(UTC_TODAY + timedelta(days=365), id="next-year"),
    ],
)
def test_create_accepts_dates(
    client: TestClient, auth: dict[str, str], calendar: InMemoryCalendar, day: date
) -> None:
    assert client.post(URL, json=_body(date=day.isoformat()), headers=auth).status_code == 201
    assert calendar.created[0]["day"] == day


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        pytest.param("Bins", "Bins", id="plain"),
        pytest.param("  Put   the\tbins\nout  ", "Put the bins out", id="squashed"),
        pytest.param("x" * 100, "x" * 100, id="max-length"),
        pytest.param("  " + "x" * 100 + "  ", "x" * 100, id="max-after-strip"),
    ],
)
def test_create_normalises_title(
    client: TestClient,
    auth: dict[str, str],
    calendar: InMemoryCalendar,
    title: str,
    expected: str,
) -> None:
    assert client.post(URL, json=_body(title=title), headers=auth).status_code == 201
    assert calendar.created[0]["title"] == expected


@pytest.mark.parametrize(
    ("location", "expected"),
    [
        pytest.param(None, None, id="null"),
        pytest.param("", None, id="empty"),
        pytest.param("   ", None, id="blank"),
        pytest.param("  The   Pub ", "The Pub", id="squashed"),
        pytest.param("x" * 200, "x" * 200, id="max-length"),
    ],
)
def test_create_normalises_location(
    client: TestClient,
    auth: dict[str, str],
    calendar: InMemoryCalendar,
    location: str | None,
    expected: str | None,
) -> None:
    assert client.post(URL, json=_body(location=location), headers=auth).status_code == 201
    assert calendar.created[0]["location"] == expected


@pytest.mark.parametrize(
    ("times", "expected_start", "expected_end"),
    [
        pytest.param({}, None, None, id="all-day"),
        pytest.param({"start_time": "09:00"}, clock(9), None, id="start-only"),
        pytest.param(
            {"start_time": "22:00", "end_time": "01:30"}, clock(22), clock(1, 30), id="both"
        ),
        pytest.param({"start_time": None, "end_time": None}, None, None, id="explicit-nulls"),
    ],
)
def test_create_passes_times(
    client: TestClient,
    auth: dict[str, str],
    calendar: InMemoryCalendar,
    times: dict,
    expected_start: clock | None,
    expected_end: clock | None,
) -> None:
    assert client.post(URL, json=_body(**times), headers=auth).status_code == 201
    created = calendar.created[0]
    assert (created["start"], created["end"]) == (expected_start, expected_end)


# --- create behaviour -----------------------------------------------------------


def test_create_returns_event(client: TestClient, auth: dict[str, str]) -> None:
    response = client.post(URL, json=_body(start_time="09:00"), headers=auth)
    assert response.status_code == 201
    body = response.json()
    assert body["id"] == "evt1"
    assert body["title"] == "Bins"
    assert body["all_day"] is False
    assert body["start"] == f"{SOON.isoformat()}T09:00:00"


@pytest.mark.parametrize(
    ("claims", "expected"),
    [
        pytest.param({"name": "Jasper"}, "Jasper", id="name-claim"),
        pytest.param({}, "", id="no-name-never-sub"),
        pytest.param({"name": ""}, "", id="empty-name"),
    ],
)
def test_create_added_by_from_name_claim(
    client: TestClient,
    make_token: TokenFactory,
    calendar: InMemoryCalendar,
    claims: dict,
    expected: str,
) -> None:
    headers = {"Authorization": f"Bearer {make_token(sub='user_secret', **claims)}"}
    assert client.post(URL, json=_body(), headers=headers).status_code == 201
    assert calendar.created[0]["added_by"] == expected


@pytest.mark.parametrize(
    ("method", "body"),
    [pytest.param("GET", None, id="list"), pytest.param("POST", _body(), id="create")],
)
def test_calendar_error_is_502(
    client: TestClient,
    auth: dict[str, str],
    calendar: InMemoryCalendar,
    method: str,
    body: dict | None,
) -> None:
    calendar.error = "google returned 500: boom"
    response = client.request(method, URL, json=body, headers=auth)
    assert response.status_code == 502
    assert response.json()["detail"] == "google returned 500: boom"
