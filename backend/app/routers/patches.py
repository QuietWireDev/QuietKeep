# QuietKeep: routers/patches.py
# Scan, patch, reboot, and history endpoints.
# Author: QuietWire (Dennis Ayotte)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    HostModel,
    PatchHistoryModel,
    PatchHistoryResponse,
    PatchRequest,
)
from app.services.patcher import patch_host
from app.services.scanner import scan_all_hosts, scan_host
from app.ssh.client import ssh_client

router = APIRouter(prefix="/api", tags=["patches"])


@router.post("/scan")
async def trigger_scan_all(db: AsyncSession = Depends(get_db)):
    """Trigger a scan of all hosts."""
    results = await scan_all_hosts(db)
    return {"message": "Scan complete", "results": results}


@router.post("/scan/{host_id}")
async def trigger_scan_host(host_id: int, db: AsyncSession = Depends(get_db)):
    """Trigger a scan of a single host."""
    result = await db.execute(select(HostModel).where(HostModel.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    scan_result = await scan_host(host, db)
    return {"message": f"Scan complete for {host.hostname}", "result": scan_result}


@router.post("/patch")
async def trigger_patch(request: PatchRequest, db: AsyncSession = Depends(get_db)):
    """Patch selected hosts."""
    results = []
    for host_id in request.host_ids:
        result = await db.execute(select(HostModel).where(HostModel.id == host_id))
        host = result.scalar_one_or_none()
        if not host:
            results.append({"host_id": host_id, "status": "not_found"})
            continue
        history = await patch_host(host, db)
        results.append({
            "host_id": host.id,
            "hostname": host.hostname,
            "status": history.status,
            "packages_updated": history.packages_updated,
        })
    return {"message": "Patching complete", "results": results}


@router.post("/patch/{host_id}")
async def trigger_patch_host(host_id: int, db: AsyncSession = Depends(get_db)):
    """Patch a single host."""
    result = await db.execute(select(HostModel).where(HostModel.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    history = await patch_host(host, db)
    return {
        "message": f"Patching complete for {host.hostname}",
        "status": history.status,
        "packages_updated": history.packages_updated,
    }


@router.post("/patch/{host_id}/install-held-back")
async def trigger_install_held_back(host_id: int, db: AsyncSession = Depends(get_db)):
    """Install the packages the last `apt-get upgrade` kept back.

    Runs `apt-get upgrade --with-new-pkgs` via the same patcher path as a
    regular patch, which pulls in new versioned subpackages (typically a
    new kernel image) without performing any removals. Creates a normal
    patch-history entry so the user sees this run alongside their other
    patches, and clears host.held_back_packages on success so the UI no
    longer shows the follow-up card.

    The operation usually leaves the host wanting a reboot; QuietKeep's
    existing reboot detection picks that up on the next scan and lights
    up the Reboot button naturally.
    """
    result = await db.execute(select(HostModel).where(HostModel.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    if host.os_type not in ("apt", "proxmox"):
        # kali already uses dist-upgrade and pacman does full upgrades, so
        # these OS types never end up with held-back packages to install.
        raise HTTPException(
            status_code=400,
            detail=f"Install-held-back does not apply to os_type={host.os_type}",
        )
    history = await patch_host(host, db, include_new_pkgs=True)
    return {
        "message": f"Held-back install complete for {host.hostname}",
        "status": history.status,
        "packages_updated": history.packages_updated,
    }


@router.post("/reboot/{host_id}")
async def trigger_reboot(host_id: int, db: AsyncSession = Depends(get_db)):
    """Reboot a single host."""
    result = await db.execute(select(HostModel).where(HostModel.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    if not host.is_patch_target:
        raise HTTPException(status_code=400, detail=f"{host.hostname} is not a patch target")
    if not host.reboot_required:
        raise HTTPException(status_code=400, detail=f"{host.hostname} does not need a reboot")

    success, message = await ssh_client.reboot_host(host.ip_address, host.username)
    if success:
        # Mark offline immediately. Host won't respond until it comes back up.
        # reboot_required clears now; next scan will re-detect if still needed.
        host.reboot_required = False
        host.is_online = False
        await db.commit()
    return {"message": message, "hostname": host.hostname, "success": success}


@router.get("/history", response_model=list[PatchHistoryResponse])
async def get_history(limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Get recent patch history across all hosts."""
    result = await db.execute(
        select(PatchHistoryModel)
        .order_by(PatchHistoryModel.started_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/history/{host_id}", response_model=list[PatchHistoryResponse])
async def get_host_history(host_id: int, db: AsyncSession = Depends(get_db)):
    """Get patch history for a specific host."""
    result = await db.execute(
        select(PatchHistoryModel)
        .where(PatchHistoryModel.host_id == host_id)
        .order_by(PatchHistoryModel.started_at.desc())
    )
    return result.scalars().all()
