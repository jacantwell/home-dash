"""Vercel entrypoint (`main:app`)."""

from api.app import create_app
from api.config import Settings

app = create_app(Settings())
