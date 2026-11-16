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
    google_calendar_id: str = ""
    # the service account's whole json key, one line; Vercel has no file to point at
    google_service_account_json: str = ""
    # gallery: S3 bucket + CloudFront, from `make output` in infra/. AWS_* names are
    # reserved on Vercel, hence the PHOTOS_ prefix on the credentials.
    photos_bucket: str = ""
    photos_region: str = "eu-west-2"
    photos_cdn_url: str = ""
    photos_cdn_key_pair_id: str = ""
    photos_cdn_private_key: str = ""
    photos_aws_access_key_id: str = ""
    photos_aws_secret_access_key: str = ""

    @property
    def photos_configured(self) -> bool:
        return all(
            (
                self.photos_bucket,
                self.photos_cdn_url,
                self.photos_cdn_key_pair_id,
                self.photos_cdn_private_key,
                self.photos_aws_access_key_id,
                self.photos_aws_secret_access_key,
            )
        )

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
