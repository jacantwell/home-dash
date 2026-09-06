import base64
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
_PK_PREFIXES = ("pk_test_", "pk_live_")


def issuer_from_publishable_key(key: str) -> str:
    """Clerk publishable keys are `pk_<env>_` + base64("<frontend-api-host>$")."""
    key = key.strip()
    for prefix in _PK_PREFIXES:
        if key.startswith(prefix):
            encoded = key.removeprefix(prefix)
            encoded += "=" * (-len(encoded) % 4)
            host = base64.b64decode(encoded).decode().rstrip("$")
            return f"https://{host}"
    raise ValueError("publishable key must start with pk_test_ or pk_live_")


class Settings(BaseSettings):
    # later files win, real env vars beat both
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR.parent / ".env.local", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = ""
    ledboard_url: str = "http://localhost:8080"
    next_public_clerk_publishable_key: str = ""
    clerk_issuer: str = ""
    clerk_authorized_parties: str = ""

    @property
    def issuer(self) -> str:
        """Empty when neither CLERK_ISSUER nor the publishable key is set."""
        if self.clerk_issuer:
            return self.clerk_issuer.rstrip("/")
        if self.next_public_clerk_publishable_key:
            return issuer_from_publishable_key(self.next_public_clerk_publishable_key)
        return ""

    @property
    def authorized_parties(self) -> frozenset[str]:
        return frozenset(p.strip() for p in self.clerk_authorized_parties.split(",") if p.strip())
