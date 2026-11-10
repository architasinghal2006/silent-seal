"""A small sliding-window rate limiter, kept in this process's memory.

It slows guessing of PINs and share links and blunts floods. It is per process and resets
on restart, which is enough for one small service. Behind several workers or instances,
replace the store with Redis.

A limited request gets 429. On the unlock route the app treats that like any other refusal:
the calculator just shows a number.
"""

import time
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from ..config import get_settings


@dataclass(frozen=True)
class Rule:
    name: str
    prefixes: tuple[str, ...]
    limit: int


def _rules() -> list[Rule]:
    s = get_settings()
    # First match wins, so the specific groups come before the catch-all.
    return [
        Rule("auth", ("/api/auth/", "/api/account/"), s.rate_limit_auth),
        Rule("demo", ("/api/demo/",), s.rate_limit_demo),
        Rule("share", ("/api/live-share/",), s.rate_limit_share_link),
        Rule("api", ("/api/",), s.rate_limit_api),
    ]


_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_lock = Lock()


def reset() -> None:
    """Forget every count. For tests."""
    with _lock:
        _hits.clear()


def _allowed(key: tuple[str, str], limit: int, window: float) -> bool:
    now = time.monotonic()
    with _lock:
        hits = _hits[key]
        while hits and now - hits[0] > window:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        # Forget idle clients so the table can't grow without bound.
        if len(_hits) > 10_000:
            for stale in [k for k, v in _hits.items() if not v or now - v[-1] > window]:
                del _hits[stale]
        return True


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request = Request(scope)
        path = request.url.path
        rule = next((r for r in _rules() if path.startswith(r.prefixes)), None)
        if rule is None or rule.limit <= 0 or request.method == "OPTIONS":
            return await self.app(scope, receive, send)

        # With --proxy-headers uvicorn has already put the forwarded address here.
        client = request.client.host if request.client else "unknown"
        window = float(get_settings().rate_limit_window_seconds)
        if _allowed((rule.name, client), rule.limit, window):
            return await self.app(scope, receive, send)
        response = JSONResponse({"detail": "too many requests"}, status_code=429, headers={"Retry-After": str(int(window))})
        await response(scope, receive, send)
