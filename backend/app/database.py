from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, create_engine, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

_url = get_settings().database_url
_connect_args = {"check_same_thread": False} if _url.startswith("sqlite") else {}

engine = create_engine(_url, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

_BACKEND_DIR = Path(__file__).resolve().parent.parent
# The schema as it was before migrations existed. Databases created then have no version table.
LEGACY_REVISION = "0001"


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def alembic_config():
    from alembic.config import Config

    config = Config()
    config.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", _url.replace("%", "%%"))
    return config


def run_migrations(target: Engine | None = None) -> None:
    """Bring a database to the current schema. Safe to run on every start."""
    from alembic import command

    config = alembic_config()
    with (target or engine).connect() as connection:
        # alembic/env.py uses this connection instead of opening its own.
        config.attributes["connection"] = connection
        tables = set(inspect(connection).get_table_names())
        if "accounts" in tables and "alembic_version" not in tables:
            command.stamp(config, LEGACY_REVISION)
        command.upgrade(config, "head")
        connection.commit()
