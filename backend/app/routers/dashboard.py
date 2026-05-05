# QuietKeep: routers/dashboard.py
# Dashboard summary endpoint. Aggregates host stats for the overview cards.
# Author: QuietWire (Dennis Ayotte)

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DashboardResponse, HostModel

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardResponse)
async def get_dashboard(db: AsyncSession = Depends(get_db)):
    """Get dashboard summary statistics.

    One round-trip to SQLite using COUNT / SUM / MAX instead of loading
    every host row and aggregating in Python. Scales linearly with
    fleet size; meaningful for deployments with many hosts.
    """
    result = await db.execute(
        select(
            func.count(HostModel.id),
            func.sum(case((HostModel.is_online.is_(True), 1), else_=0)),
            func.sum(case((HostModel.pending_updates > 0, 1), else_=0)),
            func.coalesce(func.sum(HostModel.pending_updates), 0),
            func.sum(case((HostModel.reboot_required.is_(True), 1), else_=0)),
            func.max(HostModel.last_scan),
        )
    )
    total, online, with_updates, total_packages, needing_reboot, last_scan = result.one()

    # func.sum returns NULL for empty tables; coerce to 0 so the response
    # is always integers. (total/last_scan handle their own edge cases.)
    return DashboardResponse(
        total_hosts=total or 0,
        hosts_online=online or 0,
        hosts_with_updates=with_updates or 0,
        total_pending_packages=total_packages or 0,
        hosts_needing_reboot=needing_reboot or 0,
        last_scan=last_scan,
    )
