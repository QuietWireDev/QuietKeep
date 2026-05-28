# QuietKeep: main.py
# FastAPI application entry point. Handles startup/shutdown lifecycle,
# CORS configuration, and router registration.
# Author: QuietWire (Dennis Ayotte)

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.auth import get_current_user
from app.config import settings as app_settings
from app.database import async_session, init_db
from app.models import AppSettingModel, HostModel
from app.routers import activity, auth, dashboard, docker, hosts, patches, settings as settings_router, tags, threat_intel
from app.services.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def check_hosts():
    """Log host count on startup. Empty DB is normal for first-run."""
    async with async_session() as db:
        result = await db.execute(select(HostModel))
        existing = result.scalars().all()
        if existing:
            logger.info(f"Database has {len(existing)} hosts")
        else:
            logger.info("No hosts configured. Add hosts via the web UI or CSV import")


SCHEDULER_DEFAULTS = {
    "scan_interval_hours": 6,
    "docker_scan_interval_hours": 6,
    "auto_scan_enabled": True,
}


async def _load_scheduler_settings() -> dict:
    """Read saved scan intervals and auto-scan flag from the database.

    Falls back to defaults when keys are missing (first run or no DB value).
    """
    async with async_session() as db:
        result = await db.execute(select(AppSettingModel))
        rows = {r.key: r.value for r in result.scalars().all()}

    scan_hours = int(rows.get("scan_interval_hours", SCHEDULER_DEFAULTS["scan_interval_hours"]))
    docker_hours = int(rows.get("docker_scan_interval_hours", SCHEDULER_DEFAULTS["docker_scan_interval_hours"]))
    raw_enabled = rows.get("auto_scan_enabled", "true")
    enabled = raw_enabled.lower() in ("true", "1", "yes")
    return {"scan_hours": scan_hours, "docker_hours": docker_hours, "enabled": enabled}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"Starting {app_settings.app_name}...")
    await init_db()
    await check_hosts()
    sched_cfg = await _load_scheduler_settings()
    start_scheduler(**sched_cfg)
    yield
    # Shutdown
    stop_scheduler()
    logger.info(f"{app_settings.app_name} shut down.")


app = FastAPI(
    title=app_settings.app_name,
    description="Lightweight Linux Patch Management System",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS: restrict to the QuietKeep host IP + localhost variants.
# QUIETKEEP_HOST is auto-detected by entrypoint.sh at container startup
# so the API only accepts requests from the actual server address.
_host = app_settings.quietkeep_host
_origins = [
    f"https://{_host}",
    f"http://{_host}",
    "https://localhost",
    "http://localhost",
    "http://127.0.0.1",
    "https://127.0.0.1",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth router is public (login, setup, status endpoints)
app.include_router(auth.router)

# All other routers require authentication
app.include_router(hosts.router, dependencies=[Depends(get_current_user)])
app.include_router(patches.router, dependencies=[Depends(get_current_user)])
app.include_router(dashboard.router, dependencies=[Depends(get_current_user)])
app.include_router(docker.router, dependencies=[Depends(get_current_user)])
app.include_router(settings_router.router, dependencies=[Depends(get_current_user)])
app.include_router(threat_intel.router, dependencies=[Depends(get_current_user)])
app.include_router(tags.router, dependencies=[Depends(get_current_user)])
app.include_router(activity.router, dependencies=[Depends(get_current_user)])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": app_settings.app_name}
