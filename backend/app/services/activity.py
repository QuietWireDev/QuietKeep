# QuietKeep: services/activity.py
# Lightweight activity logger. Call log_activity() from any service to record
# an event (scan, patch, reboot, docker update) for the Home page feed.
# Author: QuietWire (Dennis Ayotte)

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ActivityLogModel


async def log_activity(
    db: AsyncSession,
    event_type: str,
    message: str,
    host_id: int | None = None,
    hostname: str | None = None,
) -> None:
    """Record an activity event."""
    entry = ActivityLogModel(
        timestamp=datetime.utcnow(),
        event_type=event_type,
        host_id=host_id,
        hostname=hostname,
        message=message,
    )
    db.add(entry)
    await db.commit()
