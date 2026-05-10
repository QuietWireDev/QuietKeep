# QuietKeep: routers/activity.py
# Recent activity feed endpoint for the Home page.
# Author: QuietWire (Dennis Ayotte)

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ActivityLogModel, ActivityLogResponse

router = APIRouter(prefix="/api", tags=["activity"])


@router.get("/activity", response_model=list[ActivityLogResponse])
async def get_activity(limit: int = 30, db: AsyncSession = Depends(get_db)):
    """Get recent activity events for the Home page feed."""
    result = await db.execute(
        select(ActivityLogModel)
        .order_by(ActivityLogModel.timestamp.desc())
        .limit(limit)
    )
    return result.scalars().all()
