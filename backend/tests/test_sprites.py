import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.auth import ClerkVerifier
from api.config import Settings
from api.sprites import SPRITE_CELLS, get_sprite_repo
from tests.conftest import TokenFactory
from tests.fakes import InMemorySpriteRepo

URL = "/api/sprites"
PIXELS = "a" + "." * (SPRITE_CELLS - 1)


@pytest.fixture
def repo() -> InMemorySpriteRepo:
    return InMemorySpriteRepo()


@pytest.fixture
def client(settings: Settings, verifier: ClerkVerifier, repo: InMemorySpriteRepo) -> TestClient:
    app = create_app(settings, verifier=verifier)
    app.dependency_overrides[get_sprite_repo] = lambda: repo
    return TestClient(app)


@pytest.fixture
def auth(make_token: TokenFactory) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(name='Jasper')}"}


def _body(name: str = "smiley", pixels: str = PIXELS) -> dict:
    return {"name": name, "pixels": pixels}


# --- auth -----------------------------------------------------------------------


def test_catalog_is_public(client: TestClient) -> None:
    assert client.get(URL).status_code == 200


def test_save_requires_token(client: TestClient, repo: InMemorySpriteRepo) -> None:
    assert client.post(URL, json=_body()).status_code == 401
    assert repo.rows == []


def test_save_rejects_bad_token(
    client: TestClient, make_token: TokenFactory, repo: InMemorySpriteRepo
) -> None:
    headers = {"Authorization": f"Bearer {make_token(exp_delta=-120)}"}
    assert client.post(URL, json=_body(), headers=headers).status_code == 401
    assert repo.rows == []


# --- validation -------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({}, id="empty-body"),
        pytest.param({"pixels": PIXELS}, id="no-name"),
        pytest.param({"name": "smiley"}, id="no-pixels"),
        pytest.param(_body(name=""), id="empty-name"),
        pytest.param(_body(name="Smiley"), id="uppercase-name"),
        pytest.param(_body(name="smi ley"), id="space-in-name"),
        pytest.param(_body(name="smi-ley"), id="dash-in-name"),
        pytest.param(_body(name="_lead"), id="leading-underscore"),
        pytest.param(_body(name="a__b"), id="double-underscore"),
        pytest.param(_body(name="x" * 33), id="name-too-long"),
        pytest.param(_body(pixels="." * SPRITE_CELLS), id="all-transparent"),
        pytest.param(_body(pixels="a" * (SPRITE_CELLS - 1)), id="too-few-cells"),
        pytest.param(_body(pixels="a" * (SPRITE_CELLS + 1)), id="too-many-cells"),
        pytest.param(_body(pixels="g" + "." * (SPRITE_CELLS - 1)), id="bad-palette-char"),
        pytest.param(_body(pixels="A" + "." * (SPRITE_CELLS - 1)), id="uppercase-hex"),
        pytest.param(_body(pixels=" " + "." * (SPRITE_CELLS - 1)), id="space-cell"),
    ],
)
def test_save_rejects_bad_body(
    client: TestClient, auth: dict[str, str], repo: InMemorySpriteRepo, body: dict
) -> None:
    assert client.post(URL, json=body, headers=auth).status_code == 422
    assert repo.rows == []


@pytest.mark.parametrize("name", ["a", "smiley", "cat_2", "0", "x" * 32])
def test_save_accepts_names(client: TestClient, auth: dict[str, str], name: str) -> None:
    assert client.post(URL, json=_body(name=name), headers=auth).status_code == 201


def test_save_returns_sprite_with_author(client: TestClient, auth: dict[str, str]) -> None:
    response = client.post(URL, json=_body(), headers=auth)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "smiley"
    assert body["author_name"] == "Jasper"
    assert body["pixels"] == PIXELS
    assert (body["w"], body["h"]) == (16, 16)
    assert "clerk_user_id" not in body


def test_duplicate_name_is_409(
    client: TestClient, auth: dict[str, str], repo: InMemorySpriteRepo
) -> None:
    assert client.post(URL, json=_body(), headers=auth).status_code == 201
    response = client.post(URL, json=_body(), headers=auth)
    assert response.status_code == 409
    assert "smiley" in response.json()["detail"]
    assert len(repo.rows) == 1


# --- listing ----------------------------------------------------------------------


def _seed(repo: InMemorySpriteRepo, n: int) -> None:
    for i in range(n):
        repo.insert(name=f"s{i}", clerk_user_id="u", author_name="a", w=16, h=16, pixels=PIXELS)


def test_list_newest_first(client: TestClient, repo: InMemorySpriteRepo) -> None:
    _seed(repo, 3)
    names = [s["name"] for s in client.get(URL).json()["sprites"]]
    assert names == ["s2", "s1", "s0"]


@pytest.mark.parametrize(
    ("query", "expected_count"),
    [
        pytest.param("", 200, id="default-200"),
        pytest.param("?limit=1", 1, id="min"),
        pytest.param("?limit=500", 500, id="max"),
        pytest.param("?limit=7", 7, id="seven"),
    ],
)
def test_list_limit(
    client: TestClient, repo: InMemorySpriteRepo, query: str, expected_count: int
) -> None:
    _seed(repo, 510)
    assert len(client.get(f"{URL}{query}").json()["sprites"]) == expected_count


@pytest.mark.parametrize("limit", ["0", "501", "-1", "abc"])
def test_list_limit_out_of_bounds(client: TestClient, limit: str) -> None:
    assert client.get(f"{URL}?limit={limit}").status_code == 422


def test_list_empty(client: TestClient) -> None:
    assert client.get(URL).json() == {"sprites": []}
