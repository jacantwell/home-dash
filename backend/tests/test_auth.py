import pytest

from api.auth import AuthError, ClerkVerifier
from tests.conftest import ISSUER, ORIGIN, FakeJWKSClient, TokenFactory


def test_verify_returns_claims(verifier: ClerkVerifier, make_token: TokenFactory) -> None:
    claims = verifier.verify(make_token(sub="user_abc", name="Jasper"))
    assert claims["sub"] == "user_abc"
    assert claims["name"] == "Jasper"


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        pytest.param({"exp_delta": -60}, "expired", id="expired"),
        pytest.param({"iss": "https://evil.example"}, "issuer", id="wrong-issuer"),
        pytest.param({"azp": "http://evil.example"}, "azp", id="bad-azp"),
        pytest.param({"azp": None}, "azp", id="missing-azp"),
        pytest.param({"drop": ("iat",)}, "iat", id="missing-iat"),
        pytest.param({"drop": ("sub",)}, "sub", id="missing-sub"),
    ],
)
def test_verify_rejects(
    verifier: ClerkVerifier, make_token: TokenFactory, kwargs: dict, match: str
) -> None:
    with pytest.raises(AuthError, match=match):
        verifier.verify(make_token(**kwargs))


def test_verify_rejects_wrong_signing_key(
    verifier: ClerkVerifier, make_token: TokenFactory, other_private_pem: bytes
) -> None:
    with pytest.raises(AuthError, match="Signature"):
        verifier.verify(make_token(key=other_private_pem))


def test_verify_rejects_garbage(verifier: ClerkVerifier) -> None:
    with pytest.raises(AuthError):
        verifier.verify("not.a.jwt")


def test_empty_allow_list_skips_azp_check(rsa_keypair: tuple, make_token: TokenFactory) -> None:
    _, public_key = rsa_keypair
    open_verifier = ClerkVerifier(ISSUER, (), jwks_client=FakeJWKSClient(public_key))
    assert open_verifier.verify(make_token(azp="http://anything.example"))["azp"] != ORIGIN
