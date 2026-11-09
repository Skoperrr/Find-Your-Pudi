"""Vercel ASGI entrypoint for the FastAPI backend service."""

from main import create_app

app = create_app()
