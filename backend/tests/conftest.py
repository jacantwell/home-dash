import time
from collections.abc import Callable
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from api.app import create_app
from api.auth import ClerkVerifier
from api.config import Settings

ISSUER = "https://clean-dinosaur-8235.clerk.accounts.dev"
ORIGIN = "http://localhost:3000"
KID = "test-kid"

TokenFactory = Callable[..., str]


class _FakeSigningKey:
    def __init__(self, key: Any) -> None:
        self.key = key


class FakeJWKSClient:
    """Stands in for jwt.PyJWKClient; always hands back the fixture's public key."""

    def __init__(self, public_key: Any) -> None:
        self._key = _FakeSigningKey(public_key)

    def get_signing_key_from_jwt(self, token: str) -> _FakeSigningKey:
        return self._key


@pytest.fixture(scope="session")
def rsa_keypair() -> tuple[bytes, Any]:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return pem, private.public_key()


@pytest.fixture(scope="session")
def other_private_pem() -> bytes:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )


@pytest.fixture(scope="session")
def make_token(rsa_keypair: tuple[bytes, Any]) -> TokenFactory:
    private_pem, _ = rsa_keypair

    def _make(
        *,
        sub: str = "user_123",
        iss: str = ISSUER,
        azp: str | None = ORIGIN,
        exp_delta: int = 60,
        key: bytes | None = None,
        drop: tuple[str, ...] = (),
        **extra: Any,
    ) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "sub": sub,
            "iss": iss,
            "iat": now,
            "nbf": now - 5,
            "exp": now + exp_delta,
            **extra,
        }
        if azp is not None:
            claims["azp"] = azp
        for name in drop:
            claims.pop(name, None)
        return jwt.encode(claims, key or private_pem, algorithm="RS256", headers={"kid": KID})

    return _make


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        database_url="",
        ledboard_url="http://ledboard.test",
        clerk_issuer=ISSUER,
        clerk_authorized_parties=ORIGIN,
    )


@pytest.fixture
def verifier(settings: Settings, rsa_keypair: tuple[bytes, Any]) -> ClerkVerifier:
    _, public_key = rsa_keypair
    return ClerkVerifier(
        settings.issuer, settings.authorized_parties, jwks_client=FakeJWKSClient(public_key)
    )


@pytest.fixture
def client(settings: Settings, verifier: ClerkVerifier) -> TestClient:
    return TestClient(create_app(settings, verifier=verifier))
