from collections.abc import Iterable
from typing import Any, Protocol

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

Claims = dict[str, Any]


class SigningKeyProvider(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> Any: ...


class AuthError(Exception):
    pass


class ClerkVerifier:
    def __init__(
        self,
        issuer: str,
        authorized_parties: Iterable[str] = (),
        jwks_client: SigningKeyProvider | None = None,
    ) -> None:
        self.issuer = issuer.rstrip("/")
        self.authorized_parties = frozenset(authorized_parties)
        self._jwks = jwks_client or jwt.PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json", cache_keys=True
        )

    def verify(self, token: str) -> Claims:
        try:
            signing_key = self._jwks.get_signing_key_from_jwt(token)
            claims: Claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                issuer=self.issuer,
                options={"require": ["exp", "iat", "sub"]},
                leeway=5,
            )
        except jwt.PyJWTError as exc:
            raise AuthError(f"invalid token: {exc}") from exc
        if self.authorized_parties and claims.get("azp") not in self.authorized_parties:
            raise AuthError("token azp is not an authorized party")
        return claims


_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"}
    )


def bearer_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    if credentials is None or not credentials.credentials:
        raise _unauthorized("missing Authorization: Bearer <token> header")
    return credentials.credentials


def current_user(request: Request, token: str = Depends(bearer_token)) -> Claims:
    verifier: ClerkVerifier | None = request.app.state.verifier
    if verifier is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "auth not configured: set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY or CLERK_ISSUER",
        )
    try:
        return verifier.verify(token)
    except AuthError as exc:
        raise _unauthorized(str(exc)) from exc
