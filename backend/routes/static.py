"""Static file serving and PWA endpoints."""

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..errors import AppError, ErrorCode

router = APIRouter()

DIST_DIR = Path("static/dist")


def mount_static(app) -> None:
    """Mount static file directories on the FastAPI app.

    Must be called after all routers are included, since catch-all
    mounts would shadow API routes if registered first.
    """
    if DIST_DIR.exists():
        app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")
    app.mount("/static", StaticFiles(directory="static"), name="static")


@router.get("/")
def read_root():
    """Serve the main HTML page from Vite build or legacy templates."""
    if (DIST_DIR / "index.html").exists():
        response = FileResponse(str(DIST_DIR / "index.html"))
    else:
        response = FileResponse("templates/index.html")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@router.get("/manifest.json")
def manifest():
    """Serve the PWA manifest file."""
    if (DIST_DIR / "manifest.json").exists():
        response = FileResponse(str(DIST_DIR / "manifest.json"))
    else:
        response = FileResponse("static/manifest.json")
    response.headers["Cache-Control"] = "public, max-age=3600, must-revalidate"
    return response


@router.get("/sw.js")
def service_worker():
    """Serve the service worker script."""
    if (DIST_DIR / "sw.js").exists():
        response = FileResponse(str(DIST_DIR / "sw.js"), media_type="application/javascript")
    else:
        response = FileResponse("static/sw.js", media_type="application/javascript")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@router.get("/icons/{file_path:path}")
def serve_icon(file_path: str):
    """Serve icon files from the Vite build output or legacy static directory."""
    dist_path = DIST_DIR / "icons" / file_path
    if dist_path.exists():
        return FileResponse(str(dist_path))
    legacy_path = Path("static/icons") / file_path
    if legacy_path.exists():
        return FileResponse(str(legacy_path))
    raise AppError(ErrorCode.ICON_NOT_FOUND, "Icon not found", 404)
