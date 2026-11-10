import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import run_migrations
from .middleware import RateLimitMiddleware, SecurityHeadersMiddleware
from .routers import auth, contacts, demo, health, live_share, offline_queue, sos, vault, zones

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("silentseal")


@asynccontextmanager
async def lifespan(_: FastAPI):
    run_migrations()
    yield


app = FastAPI(
    title="Silent Seal API",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

# The last one added runs first, so security headers also go on a rate limiter's 429.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(SecurityHeadersMiddleware)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Says which fields were wrong, never what was sent: a rejected body can hold a PIN or a location."""
    fields = sorted({".".join(str(part) for part in error["loc"][1:]) or "body" for error in exc.errors()})
    return JSONResponse({"detail": "invalid request", "fields": fields}, status_code=422)


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled %s on %s %s", exc.__class__.__name__, request.method, request.url.path)
    return JSONResponse({"detail": "server error"}, status_code=500)


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(sos.router)
app.include_router(live_share.router)
app.include_router(vault.router)
app.include_router(zones.router)
app.include_router(offline_queue.router)
app.include_router(demo.router)
app.mount("/api/assets", StaticFiles(directory=Path(__file__).parent / "static"), name="assets")


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
