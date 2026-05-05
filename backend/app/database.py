# QuietKeep: database.py
# Async SQLAlchemy engine and session factory for SQLite.
# Author: QuietWire (Dennis Ayotte)

import logging

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import settings

logger = logging.getLogger(__name__)

# NullPool: every checkout opens a fresh connection and returns it on release.
# This avoids QueuePool exhaustion when asyncio.gather launches many concurrent
# scan tasks that each need their own session. SQLite WAL + busy_timeout handle
# the actual write serialisation.
engine = create_async_engine(settings.database_url, echo=False, poolclass=NullPool)


# SQLite doesn't enforce foreign keys by default. Must enable per connection.
# Without this, CASCADE deletes on docker_stacks won't propagate to containers/history.
#
# WAL journal mode (write-ahead logging) lets readers continue uninterrupted
# while a writer is active. QuietKeep is read-mostly with periodic scan writes,
# so WAL significantly reduces contention during `Scan All Hosts`.
# synchronous=NORMAL pairs with WAL: durable across crashes but not across
# power loss on the filesystem level. Acceptable trade-off for a dev/homelab
# management app where scan data is regenerated on demand.
#
# busy_timeout tells SQLite to retry for up to N milliseconds when a writer
# collides with another active writer (WAL allows concurrent readers but only
# one writer at a time). Default is 0 which means "fail immediately on lock".
# 60 seconds accommodates parallel Docker/system scans where multiple tasks
# may try to commit near the same moment. If you exceed this timeout the DB
# is under real contention and shortening transaction scope is the next lever.
@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=60000")
    cursor.close()

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def _ensure_column(conn, table: str, column: str, col_type: str) -> None:
    """Add `column` to `table` if it does not already exist. SQLite-only."""
    result = await conn.exec_driver_sql(f"PRAGMA table_info({table})")
    existing = {row[1] for row in result.fetchall()}
    if column not in existing:
        logger.info(f"Migration: adding column {table}.{column} ({col_type})")
        await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")


async def _ensure_index(conn, name: str, table: str, columns: str) -> None:
    """Create an index if it does not already exist. SQLite-only.

    `columns` is the column list as it appears inside CREATE INDEX parens,
    e.g. "host_id" or "host_id, stack_name". Logs only when actually creating
    a new index so subsequent startups stay quiet.
    """
    result = await conn.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        (name,),
    )
    if result.fetchone():
        return
    # Guard: only attempt creation if the target table exists. On a brand-new
    # DB this function runs before create_all, so the table is not there yet
    # and create_all will handle index creation from the ORM metadata.
    table_exists = await conn.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    )
    if not table_exists.fetchone():
        return
    logger.info(f"Migration: creating index {name} on {table}({columns})")
    await conn.exec_driver_sql(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns})")


async def _migrate(conn) -> None:
    """In-place schema migrations for evolving columns and indexes on existing DBs.

    SQLAlchemy's create_all only creates missing tables and their indexes at
    creation time; it will not retroactively add indexes or columns to tables
    that already exist. For small additive changes we issue explicit SQL here
    so users upgrading from an earlier schema do not need to wipe their DB.
    """
    # Guard: if the hosts table does not exist yet, create_all will handle
    # both tables and index creation from scratch. Column migrations below
    # all target pre-existing tables.
    result = await conn.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='hosts'"
    )
    if not result.fetchone():
        return

    # Column migrations. Sudoers columns were added when sudoers probing
    # shipped. held_back_packages was added when held-back package
    # surfacing shipped; stores a JSON-encoded list of package names.
    await _ensure_column(conn, "hosts", "sudoers_ok", "BOOLEAN")
    await _ensure_column(conn, "hosts", "sudoers_last_checked", "DATETIME")
    await _ensure_column(conn, "hosts", "held_back_packages", "TEXT")
    await _ensure_column(conn, "hosts", "last_boot_at", "DATETIME")
    await _ensure_column(conn, "hosts", "kernel_version", "VARCHAR")
    await _ensure_column(conn, "hosts", "os_pretty_name", "VARCHAR")

    # Index migrations. Mirrors the index=True / composite Index() declarations
    # in models.py so existing DBs pick up the same indexes a fresh DB gets.
    # Names match SQLAlchemy's default naming convention (ix_<table>_<col>) so
    # they line up with what create_all emits on a new install.
    await _ensure_index(conn, "ix_packages_host_id", "packages", "host_id")
    await _ensure_index(conn, "ix_patch_history_host_id", "patch_history", "host_id")
    await _ensure_index(conn, "ix_patch_history_started_at", "patch_history", "started_at")
    await _ensure_index(conn, "ix_docker_stacks_host_id", "docker_stacks", "host_id")
    await _ensure_index(
        conn,
        "ix_docker_stacks_host_id_stack_name",
        "docker_stacks",
        "host_id, stack_name",
    )
    await _ensure_index(conn, "ix_docker_containers_stack_id", "docker_containers", "stack_id")
    await _ensure_index(
        conn,
        "ix_docker_containers_stack_id_container_name",
        "docker_containers",
        "stack_id, container_name",
    )
    await _ensure_index(conn, "ix_docker_update_history_stack_id", "docker_update_history", "stack_id")
    await _ensure_index(
        conn,
        "ix_docker_update_history_started_at",
        "docker_update_history",
        "started_at",
    )


async def init_db():
    async with engine.begin() as conn:
        await _migrate(conn)
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
