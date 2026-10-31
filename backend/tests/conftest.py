import os
import tempfile

# Configure before the app is imported: isolated SQLite DB and a throwaway secret.
_tmpdir = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmpdir}/test.db"
os.environ["JWT_SECRET"] = "test-only-secret-not-used-anywhere-else"
os.environ["MAX_FAILED_ATTEMPTS"] = "3"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def account(client):
    r = client.post("/api/auth/setup", json={"real_pin": "1234", "duress_pin": "9876"})
    assert r.status_code == 201
    return r.json()["account_id"]
