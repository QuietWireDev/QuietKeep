# QuietKeep: routers/docker.py
# Docker stack management endpoints: list, scan, update, history.
# Author: QuietWire (Dennis Ayotte)

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.orm import joinedload, selectinload

from app.database import async_session
from app.models import (
    DockerContainerModel,
    DockerDashboardResponse,
    DockerStackDetailResponse,
    DockerStackModel,
    DockerStackResponse,
    DockerUpdateHistoryModel,
    DockerUpdateHistoryResponse,
    HostModel,
)
from app.services.activity import log_activity
from app.services.docker_scanner import scan_all_docker_hosts, scan_docker_host_by_id
from app.services.docker_updater import update_stack_by_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/docker", tags=["docker"])


@router.get("/dashboard", response_model=DockerDashboardResponse)
async def docker_dashboard():
    """Docker dashboard summary stats.

    Two aggregate round-trips (one per table) instead of loading every
    stack and container row. `docker_hosts` only counts hosts that have
    at least one discovered stack, matching the previous behavior where
    has_docker=True alone did not inflate the count.
    """
    async with async_session() as db:
        stacks_row = (await db.execute(
            select(
                func.count(DockerStackModel.id),
                func.sum(case((DockerStackModel.has_updates.is_(True), 1), else_=0)),
                func.count(func.distinct(DockerStackModel.host_id)),
                func.max(DockerStackModel.last_scan),
            )
        )).one()
        total_stacks, stacks_with_updates, docker_hosts, last_scan = stacks_row

        containers_row = (await db.execute(
            select(
                func.count(DockerContainerModel.id),
                func.sum(case((DockerContainerModel.has_update.is_(True), 1), else_=0)),
            )
        )).one()
        total_containers, containers_with_updates = containers_row

        return DockerDashboardResponse(
            total_stacks=total_stacks or 0,
            stacks_with_updates=stacks_with_updates or 0,
            total_containers=total_containers or 0,
            containers_with_updates=containers_with_updates or 0,
            docker_hosts=docker_hosts or 0,
            last_scan=last_scan,
        )


@router.get("/stacks", response_model=list[DockerStackResponse])
async def list_stacks():
    """List all Docker stacks across all hosts."""
    async with async_session() as db:
        result = await db.execute(
            select(DockerStackModel, HostModel.hostname, HostModel.ip_address)
            .join(HostModel)
            .order_by(HostModel.hostname, DockerStackModel.stack_name)
        )
        rows = result.all()

        stacks = []
        for stack, hostname, host_ip in rows:
            stacks.append(DockerStackResponse(
                id=stack.id,
                host_id=stack.host_id,
                stack_name=stack.stack_name,
                compose_path=stack.compose_path,
                status=stack.status,
                container_count=stack.container_count,
                has_updates=stack.has_updates,
                last_scan=stack.last_scan,
                hostname=hostname,
                host_ip=host_ip,
            ))
        return stacks


@router.get("/stacks/{stack_id}", response_model=DockerStackDetailResponse)
async def get_stack_detail(stack_id: int):
    """Get detailed info for a Docker stack including containers.

    Eager-loads containers (selectinload, separate query) and the parent
    host (joinedload, JOIN) in the initial SELECT. Avoids the extra
    round-trips that db.refresh(stack, [...]) used to emit.
    Mirrors the pattern already in use at routers/hosts.py get_host.
    """
    async with async_session() as db:
        result = await db.execute(
            select(DockerStackModel)
            .options(
                selectinload(DockerStackModel.containers),
                joinedload(DockerStackModel.host),
            )
            .where(DockerStackModel.id == stack_id)
        )
        stack = result.scalar_one_or_none()
        if not stack:
            raise HTTPException(status_code=404, detail="Stack not found")

        return DockerStackDetailResponse(
            id=stack.id,
            host_id=stack.host_id,
            stack_name=stack.stack_name,
            compose_path=stack.compose_path,
            status=stack.status,
            container_count=stack.container_count,
            has_updates=stack.has_updates,
            last_scan=stack.last_scan,
            hostname=stack.host.hostname,
            host_ip=stack.host.ip_address,
            containers=[c for c in stack.containers],
        )


@router.get("/history/{stack_id}", response_model=list[DockerUpdateHistoryResponse])
async def get_stack_history(stack_id: int):
    """Get update history for a Docker stack."""
    async with async_session() as db:
        result = await db.execute(
            select(DockerUpdateHistoryModel)
            .where(DockerUpdateHistoryModel.stack_id == stack_id)
            .order_by(DockerUpdateHistoryModel.started_at.desc())
            .limit(20)
        )
        return result.scalars().all()


@router.post("/scan")
async def scan_all_docker():
    """Scan all Docker-enabled hosts for compose stacks and updates."""
    async with async_session() as db:
        results = await scan_all_docker_hosts(db)
        await log_activity(db, 'docker_scan', f'Docker fleet scan complete: {len(results)} hosts scanned')
    return {"status": "ok", "results": results}


@router.post("/scan/{host_id}")
async def scan_docker_host(host_id: int):
    """Scan a single host for Docker stacks and updates."""
    result = await scan_docker_host_by_id(host_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail="Host not found")
    return result


@router.post("/update/{stack_id}")
async def update_docker_stack(stack_id: int):
    """Pull latest images and recreate a Docker stack."""
    try:
        history = await update_stack_by_id(stack_id)
        async with async_session() as db:
            result = await db.execute(
                select(DockerStackModel).options(joinedload(DockerStackModel.host)).where(DockerStackModel.id == stack_id)
            )
            stack = result.scalar_one_or_none()
            name = stack.stack_name if stack else f'stack {stack_id}'
            hname = stack.host.hostname if stack and stack.host else None
            await log_activity(db, 'docker_update', f'Updated {name}: {history.status}, {history.images_updated} images', hostname=hname)
        return {
            "status": history.status,
            "images_updated": history.images_updated,
            "log_output": history.log_output,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Docker stack update failed for stack {stack_id}: {e}")
        raise HTTPException(status_code=500, detail="Update failed")
