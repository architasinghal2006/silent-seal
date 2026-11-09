"""Single-service deploy: config normalisation and serving the built frontend."""

import importlib

import pytest
from fastapi.testclient import TestClient

from app import config as config_module


def _settings(monkeypatch, **env):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return config_module.Settings()


@pytest.mark.parametrize(
    "given",
    ["postgres://u:p@host/db?sslmode=require", "postgresql://u:p@host/db?sslmode=require"],
)
def test_hosted_postgres_url_uses_psycopg3(monkeypatch, given):
    s = _settings(monkeypatch, DATABASE_URL=given)
    assert s.database_url == "postgresql+psycopg://u:p@host/db?sslmode=require"


def test_explicit_driver_and_sqlite_untouched(monkeypatch):
    assert _settings(monkeypatch, DATABASE_URL="postgresql+psycopg://u@h/d").database_url == "postgresql+psycopg://u@h/d"
    assert _settings(monkeypatch, DATABASE_URL="sqlite:///./x.db").database_url == "sqlite:///./x.db"


def test_public_url_defaults_to_render_url(monkeypatch):
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    s = _settings(monkeypatch, RENDER_EXTERNAL_URL="https://calc.onrender.com")
    assert s.public_base_url == "https://calc.onrender.com"


def test_explicit_public_url_wins(monkeypatch):
    s = _settings(monkeypatch, RENDER_EXTERNAL_URL="https://calc.onrender.com", PUBLIC_BASE_URL="https://mine.example")
    assert s.public_base_url == "https://mine.example"


@pytest.fixture()
def served(tmp_path, monkeypatch):
    """Reload the app with FRONTEND_DIST pointing at a fake build."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>calculator</html>")
    (dist / "sw.js").write_text("// sw")
    (dist / "assets" / "index-abc123.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("outside dist")

    monkeypatch.setenv("FRONTEND_DIST", str(dist))
    config_module.get_settings.cache_clear()
    import app.main as main_module

    main_module = importlib.reload(main_module)
    with TestClient(main_module.app) as c:
        yield c
    monkeypatch.delenv("FRONTEND_DIST")
    config_module.get_settings.cache_clear()
    importlib.reload(main_module)


def test_root_serves_index_without_caching(served):
    r = served.get("/")
    assert r.status_code == 200 and "calculator" in r.text
    assert r.headers["cache-control"] == "no-cache"


def test_service_worker_not_cached(served):
    r = served.get("/sw.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"


def test_hashed_assets_cached_long(served):
    r = served.get("/assets/index-abc123.js")
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]


def test_unknown_path_falls_back_to_index(served):
    r = served.get("/some/client/route")
    assert r.status_code == 200 and "calculator" in r.text


def test_api_still_wins_and_unknown_api_is_json_404(served):
    assert served.get("/api/health").json()["status"] == "ok"
    r = served.get("/api/does-not-exist")
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}


def test_no_path_traversal(served):
    r = served.get("/..%2fsecret.txt")
    assert "outside dist" not in r.text
