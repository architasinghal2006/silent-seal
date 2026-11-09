import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import Base, engine
from .routers import auth, contacts, demo, health, live, offline, sos, vault, zones

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Silent Seal API",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(sos.router)
app.include_router(live.router)
app.include_router(vault.router)
app.include_router(zones.router)
app.include_router(offline.router)
app.include_router(demo.router)
app.mount("/api/share-assets", StaticFiles(directory=Path(__file__).parent / "static"), name="share-assets")


# --- Built frontend (single-service deploy) ---------------------------------
# When FRONTEND_DIST points at a `vite build` output, this app also serves the PWA,
# so the frontend and /api share one origin and no proxy rules are needed.
# Registered last, so every /api route above takes precedence.
_frontend_dist = get_settings().frontend_dist_path
if _frontend_dist is not None:
    _index = _frontend_dist / "index.html"
    # The shell and service worker must be revalidated, or phones keep an old build.
    _NO_CACHE = {"index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> Response:
        if path == "api" or path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = (_frontend_dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(_frontend_dist):
            target = candidate
        else:
            target = _index  # SPA fallback
        headers = {"Cache-Control": "no-cache"} if target.name in _NO_CACHE else None
        if target.parent.name == "assets":
            headers = {"Cache-Control": "public, max-age=31536000, immutable"}  # hashed filenames
        return FileResponse(target, headers=headers)
