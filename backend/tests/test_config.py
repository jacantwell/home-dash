import base64

import pytest

from api.config import Settings, issuer_from_publishable_key

HOST = "clean-dinosaur-8235.clerk.accounts.dev"


def _pk(prefix: str, host: str = HOST) -> str:
    return prefix + base64.b64encode(f"{host}$".encode()).decode()


@pytest.mark.parametrize("prefix", ["pk_test_", "pk_live_"])
def test_issuer_from_publishable_key(prefix: str) -> None:
    assert issuer_from_publishable_key(_pk(prefix)) == f"https://{HOST}"


def test_issuer_from_real_dev_key() -> None:
    key = "pk_test_Y2xlYW4tZGlub3NhdXItODIzNS5jbGVyay5hY2NvdW50cy5kZXYk"
    assert issuer_from_publishable_key(key) == f"https://{HOST}"


@pytest.mark.parametrize("bad", ["", "sk_test_abc", "pk_prod_abc"])
def test_issuer_from_publishable_key_rejects(bad: str) -> None:
    with pytest.raises(ValueError):
        issuer_from_publishable_key(bad)


@pytest.mark.parametrize("prefix", ["pk_test_", "pk_live_"])
def test_settings_derive_issuer(prefix: str) -> None:
    settings = Settings(_env_file=None, next_public_clerk_publishable_key=_pk(prefix))
    assert settings.issuer == f"https://{HOST}"


def test_settings_issuer_empty_when_unconfigured() -> None:
    assert Settings(_env_file=None).issuer == ""


def test_settings_explicit_issuer_wins() -> None:
    settings = Settings(
        _env_file=None,
        clerk_issuer="https://custom.example/",
        next_public_clerk_publishable_key=_pk("pk_test_"),
    )
    assert settings.issuer == "https://custom.example"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("", frozenset()),
        ("http://localhost:3000", frozenset({"http://localhost:3000"})),
        (
            " http://localhost:3000, https://home.example ,",
            frozenset({"http://localhost:3000", "https://home.example"}),
        ),
    ],
)
def test_settings_authorized_parties(raw: str, expected: frozenset[str]) -> None:
    assert Settings(_env_file=None, clerk_authorized_parties=raw).authorized_parties == expected
