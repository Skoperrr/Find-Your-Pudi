"""Vercel ASGI entrypoint for the FastAPI backend service."""

try:
    from .main import create_app
except ImportError:  # Vercel imports this module directly from the service root.
    from main import create_app

app = create_app()
