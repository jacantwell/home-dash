from fastapi import FastAPI

from api.auth import ClerkVerifier
from api.config import Settings


def create_app(settings: Settings, verifier: ClerkVerifier | None = None) -> FastAPI:
    app = FastAPI(title="home-dash-api", version="0.1.0")
    app.state.settings = settings
    if verifier is None and settings.issuer:
        verifier = ClerkVerifier(settings.issuer, settings.authorized_parties)
    # None -> auth routes answer 503 instead of the whole service failing to import
    app.state.verifier = verifier

    @app.get("/api/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    return app
