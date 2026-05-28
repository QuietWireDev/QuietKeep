# QuietKeep: services/scheduler.py
# APScheduler jobs for periodic host scanning, Docker scanning, and history cleanup.
# Supports live rescheduling from the Settings UI without container restart.
# Author: QuietWire (Dennis Ayotte)

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import delete

from app.database import async_session
from app.models import PatchHistoryModel
from app.services.scanner import scan_all_hosts
from app.services.docker_scanner import scan_all_docker_hosts

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()

# Patch history older than this is auto-deleted daily to keep DB size reasonable.
HISTORY_RETENTION_DAYS = 30

# Offset between the system scan and Docker scan. Both jobs default to the same
# interval (hours) so without an offset they would fire at the same moment and
# try to open SSH sessions to every host simultaneously. A 30-minute head start
# for the system scan keeps the two workloads staggered.
DOCKER_SCAN_OFFSET_MINUTES = 30


async def scheduled_scan():
    """Run a full scan of all hosts on schedule."""
    logger.info("Scheduled scan starting...")
    async with async_session() as db:
        results = await scan_all_hosts(db)
        online = sum(1 for r in results if r["status"] == "scanned")
        logger.info(f"Scheduled scan complete: {online}/{len(results)} hosts scanned")


async def scheduled_docker_scan():
    """Run a Docker stack scan on all Docker-enabled hosts on schedule."""
    logger.info("Scheduled Docker scan starting...")
    async with async_session() as db:
        results = await scan_all_docker_hosts(db)
        scanned = sum(1 for r in results if r["status"] == "scanned")
        logger.info(f"Scheduled Docker scan complete: {scanned}/{len(results)} hosts scanned")


async def cleanup_old_history():
    """Delete patch history records older than the retention period."""
    cutoff = datetime.utcnow() - timedelta(days=HISTORY_RETENTION_DAYS)
    async with async_session() as db:
        result = await db.execute(
            delete(PatchHistoryModel).where(PatchHistoryModel.started_at < cutoff)
        )
        deleted = result.rowcount
        await db.commit()
        if deleted > 0:
            logger.info(f"Cleaned up {deleted} patch history records older than {HISTORY_RETENTION_DAYS} days")


def _docker_first_run(interval_hours: int) -> datetime:
    """First scheduled run time for the Docker scan job.

    APScheduler's `interval` trigger defaults the first fire time to
    `now + interval`. The system scan inherits that default. We want
    the Docker scan to land DOCKER_SCAN_OFFSET_MINUTES AFTER the system
    scan on every cycle, so the Docker job's first fire is explicitly
    set to `now + interval + offset`. From there the equal intervals
    keep the two jobs the same offset apart forever.
    """
    return datetime.utcnow() + timedelta(
        hours=interval_hours,
        minutes=DOCKER_SCAN_OFFSET_MINUTES,
    )


def start_scheduler(scan_hours: int = 6, docker_hours: int = 6, enabled: bool = True):
    """Start the periodic scan scheduler.

    Parameters come from the database at startup so saved settings survive
    container restarts. Falls back to 6-hour defaults when no DB value exists.
    Pass enabled=False to start with auto-scan off.
    """
    if enabled:
        scheduler.add_job(
            scheduled_scan,
            "interval",
            hours=scan_hours,
            id="periodic_scan",
            replace_existing=True,
        )
        scheduler.add_job(
            scheduled_docker_scan,
            "interval",
            hours=docker_hours,
            id="periodic_docker_scan",
            replace_existing=True,
            next_run_time=_docker_first_run(docker_hours),
        )
    scheduler.add_job(
        cleanup_old_history,
        "interval",
        hours=24,
        id="history_cleanup",
        replace_existing=True,
    )
    scheduler.start()
    if enabled:
        logger.info(
            f"Scheduler started: system scan every {scan_hours}h, "
            f"Docker scan every {docker_hours}h "
            f"(Docker first run offset by {DOCKER_SCAN_OFFSET_MINUTES} min), "
            f"history cleanup every 24h (retention: {HISTORY_RETENTION_DAYS} days)"
        )
    else:
        logger.info("Scheduler started with auto-scan disabled. History cleanup every 24h.")


def reschedule_jobs(scan_hours: int, docker_hours: int, enabled: bool):
    """Update scan intervals live without restarting."""
    if not scheduler.running:
        return

    if enabled:
        scheduler.add_job(
            scheduled_scan,
            "interval",
            hours=scan_hours,
            id="periodic_scan",
            replace_existing=True,
        )
        scheduler.add_job(
            scheduled_docker_scan,
            "interval",
            hours=docker_hours,
            id="periodic_docker_scan",
            replace_existing=True,
            next_run_time=_docker_first_run(docker_hours),
        )
        logger.info(
            f"Scheduler updated: system scan every {scan_hours}h, "
            f"Docker scan every {docker_hours}h "
            f"(Docker first run offset by {DOCKER_SCAN_OFFSET_MINUTES} min)"
        )
    else:
        for job_id in ("periodic_scan", "periodic_docker_scan"):
            job = scheduler.get_job(job_id)
            if job:
                scheduler.remove_job(job_id)
        logger.info("Auto-scan disabled")


def stop_scheduler():
    """Shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Scheduler stopped")
