import os
import tempfile

# Configure before the app is imported: isolated SQLite DB and a throwaway secret.
_tmpdir = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmpdir}/test.db"
os.environ["JWT_SECRET"] = "test-only-secret-not-used-anywhere-else"
os.environ["MAX_FAILED_ATTEMPTS"] = "3"
os.environ["DEMO_DASHBOARD_TOKEN"] = ""
# Every test comes from one address, so the real limits would trip. test_security.py lowers them on purpose.
for _limit in ("AUTH", "SHARE_LINK", "DEMO", "API"):
    os.environ[f"RATE_LIMIT_{_limit}"] = "100000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.middleware import rate_limit  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    rate_limit.reset()
    yield


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def account(client):
    """A fresh user's id. Real PIN 1234, duress PIN 9876."""
    r = client.post("/api/auth/setup", json={"real_pin": "1234", "duress_pin": "9876"})
    assert r.status_code == 201
    return r.json()["user_id"]


def unlock(client, user_id: str, pin: str) -> dict[str, str]:
    r = client.post("/api/auth/unlock", json={"user_id": user_id, "pin": pin})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def demo(monkeypatch):
    """Turns the demo tools on and returns the header that authorises the dashboard's data routes."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "demo_dashboard_token", "demo-token")
    return {"X-Demo-Token": "demo-token"}


@pytest.fixture()
def real(client, account):
    return unlock(client, account, "1234")


@pytest.fixture()
def duress(client, account):
    return unlock(client, account, "9876")
