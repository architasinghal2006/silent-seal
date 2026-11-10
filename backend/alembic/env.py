"""Runs migrations against the app's own database, so there is one source for the database URL."""

from alembic import context

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.database import Base, engine

target_metadata = Base.metadata

if context.is_offline_mode():
    raise SystemExit("Offline SQL generation is not set up. Run migrations against a database.")


def _run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite can't alter most things in place, so tables are rebuilt. A no-op on Postgres.
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# The app hands over its connection (app/database.py). The `alembic` command line opens one here.
_given = context.config.attributes.get("connection")
if _given is not None:
    _run(_given)
else:
    with engine.connect() as _connection:
        _run(_connection)
        _connection.commit()
