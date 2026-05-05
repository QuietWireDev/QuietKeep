# QuietKeep: routers/hosts.py
# Host CRUD, SSH connectivity test, CSV import/export.
# Author: QuietWire (Dennis Ayotte)

import csv
import io
import logging
from datetime import datetime

import asyncssh
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models import HostCreate, HostDetailResponse, HostModel, HostResponse, HostUpdate, SudoersFixRequest
from app.ssh.client import ssh_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hosts", tags=["hosts"])

VALID_OS_TYPES = {"apt", "pacman", "proxmox", "kali"}


@router.get("", response_model=list[HostResponse])
async def list_hosts(db: AsyncSession = Depends(get_db)):
    """List all hosts with their current status."""
    result = await db.execute(select(HostModel).order_by(HostModel.hostname))
    hosts = result.scalars().all()
    return hosts


@router.get("/template")
async def download_csv_template():
    """Download an example CSV template for host imports."""
    template = (
        "hostname,ip_address,username,os_type,is_patch_target,has_docker\n"
        "web-server-01,192.168.1.10,admin,apt,true,false\n"
        "db-server-01,192.168.1.11,admin,apt,true,true\n"
        "proxmox-node-1,192.168.1.20,root,proxmox,true,false\n"
        "arch-desktop,192.168.1.30,user,pacman,true,false\n"
        "kali-box,192.168.1.40,user,kali,true,false\n"
        "monitor-only-host,192.168.1.50,admin,apt,false,false\n"
    )
    return StreamingResponse(
        iter([template]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=quietkeep-hosts-template.csv"},
    )


@router.get("/export")
async def export_hosts_csv(db: AsyncSession = Depends(get_db)):
    """Export all hosts as a CSV file."""
    result = await db.execute(select(HostModel).order_by(HostModel.hostname))
    hosts = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["hostname", "ip_address", "username", "os_type", "is_patch_target", "has_docker"])
    for h in hosts:
        writer.writerow([h.hostname, h.ip_address, h.username, h.os_type, h.is_patch_target, h.has_docker])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=quietkeep-hosts.csv"},
    )


@router.get("/{host_id}", response_model=HostDetailResponse)
async def get_host(host_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single host with its pending packages."""
    result = await db.execute(
        select(HostModel)
        .options(selectinload(HostModel.packages))
        .where(HostModel.id == host_id)
    )
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    return host


@router.post("", response_model=HostResponse, status_code=201)
async def create_host(host_data: HostCreate, db: AsyncSession = Depends(get_db)):
    """Add a new host."""
    if host_data.os_type not in VALID_OS_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid os_type. Must be one of: {', '.join(sorted(VALID_OS_TYPES))}")

    existing = await db.execute(select(HostModel).where(HostModel.hostname == host_data.hostname))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Host '{host_data.hostname}' already exists")

    host = HostModel(**host_data.model_dump())
    db.add(host)
    await db.commit()
    await db.refresh(host)
    logger.info(f"Host created: {host.hostname} ({host.ip_address})")
    return host


@router.put("/{host_id}", response_model=HostResponse)
async def update_host(host_id: int, host_data: HostUpdate, db: AsyncSession = Depends(get_db)):
    """Update an existing host."""
    result = await db.execute(select(HostModel).where(HostModel.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    update_fields = host_data.model_dump(exclude_unset=True)

    if "os_type" in update_fields and update_fields["os_type"] not in VALID_OS_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid os_type. Must be one of: {', '.join(sorted(VALID_OS_TYPES))}")

    if "hostname" in update_fields and update_fields["hostname"] != host.hostname:
        existing = await db.execute(select(HostModel).where(HostModel.hostname == update_fields["hostname"]))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Host '{update_fields['hostname']}' already exists")

    for key, value in update_fields.items():
        setattr(host, key, value)

    await db.commit()
    await db.refresh(host)
    logger.info(f"Host updated: {host.hostname} ({host.ip_address})")
    return host


@router.delete("", status_code=204)
async def delete_all_hosts(db: AsyncSession = Depends(get_db)):
    """Delete all hosts and their related data. This action is irreversible."""
    result = await db.execute(select(HostModel))
    hosts = result.scalars().all()
    count = len(hosts)
    for host in hosts:
        await db.delete(host)
    await db.commit()
    logger.info(f"All hosts deleted ({count} total)")
    return None


@router.delete("/{host_id}", status_code=204)
async def delete_host(host_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a host and all related data (packages, history, Docker stacks)."""
    result = await db.execute(select(HostModel).where(HostModel.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    hostname = host.hostname
    await db.delete(host)
    await db.commit()
    logger.info(f"Host deleted: {hostname}")
    return None


@router.post("/{host_id}/probe-sudoers")
async def probe_sudoers_endpoint(host_id: int, db: AsyncSession = Depends(get_db)):
    """
    Re-run the NOPASSWD sudoers probe for a single host and persist the
    result. Lets the UI show fresh sudoers status after fixing a host
    manually, without waiting for the next scheduled scan.
    """
    result = await db.execute(select(HostModel).where(HostModel.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    online, ok = await ssh_client.probe_sudoers(host.ip_address, host.username, host.os_type)
    host.is_online = online
    host.sudoers_ok = ok
    host.sudoers_last_checked = datetime.utcnow()
    await db.commit()
    return {"hostname": host.hostname, "is_online": online, "sudoers_ok": ok}


@router.post("/{host_id}/fix-sudoers")
async def fix_sudoers_endpoint(
    host_id: int,
    request: SudoersFixRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Install /etc/sudoers.d/quietkeep-<username> on a host using a one-time
    password. The password is used for this request only and is not stored
    or logged. After install, immediately re-probe so the response reflects
    the new state.
    """
    result = await db.execute(select(HostModel).where(HostModel.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    if host.username == "root":
        raise HTTPException(status_code=400, detail="Root user does not need a sudoers file")

    success, message = await ssh_client.install_sudoers(
        host.ip_address, host.username, request.password, host.os_type,
    )
    if not success:
        # Record the failure without changing the password path so the UI can
        # distinguish 'install rejected' from 'probe says no' on next scan.
        host.sudoers_last_checked = datetime.utcnow()
        await db.commit()
        return {
            "success": False,
            "hostname": host.hostname,
            "message": message,
            "sudoers_ok": host.sudoers_ok,
        }

    # Install succeeded. Immediately re-probe so the persisted status is
    # authoritative rather than optimistic.
    online, ok = await ssh_client.probe_sudoers(host.ip_address, host.username, host.os_type)
    host.is_online = online
    host.sudoers_ok = ok
    host.sudoers_last_checked = datetime.utcnow()
    await db.commit()
    logger.info(f"Sudoers installed on {host.hostname}: probe={'OK' if ok else 'FAIL'}")
    return {
        "success": True,
        "hostname": host.hostname,
        "message": message,
        "is_online": online,
        "sudoers_ok": ok,
    }


@router.post("/{host_id}/test")
async def test_host_connection(host_id: int, db: AsyncSession = Depends(get_db)):
    """Test SSH connectivity to a host and persist the result.

    Historically this endpoint only returned success/failure to the modal
    and never touched the DB, so the host status indicator stayed stale
    until the next full scan. Now it updates is_online, last_scan, and
    the sudoers probe in one pass so the list view reflects reality
    immediately after the user clicks Test.
    """
    result = await db.execute(select(HostModel).where(HostModel.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    now = datetime.utcnow()
    try:
        # known_hosts=None: accepted risk for managed LAN infrastructure.
        # config=False: ignore ~/.ssh/config to use only our key path.
        async with asyncssh.connect(
            host.ip_address,
            username=host.username,
            client_keys=[settings.ssh_key_path],
            known_hosts=None,
            connect_timeout=settings.ssh_timeout,
            config=False,
        ) as conn:
            await conn.run("echo ok", check=True, timeout=10)

        # Connection succeeded. Refresh sudoers probe while we are here so
        # the badge updates in the same click. probe_sudoers returns
        # (online, sudoers_ok); online is always True here but we keep the
        # unpack for consistency with the shared helper signature.
        _online, sudoers_ok = await ssh_client.probe_sudoers(host.ip_address, host.username, host.os_type)
        host.is_online = True
        host.sudoers_ok = sudoers_ok
        host.sudoers_last_checked = now
        host.last_scan = now
        await db.commit()
        return {
            "success": True,
            "hostname": host.hostname,
            "message": "SSH connection successful",
            "is_online": True,
            "sudoers_ok": sudoers_ok,
        }
    except Exception as e:
        host.is_online = False
        host.last_scan = now
        await db.commit()
        return {
            "success": False,
            "hostname": host.hostname,
            "message": str(e),
            "is_online": False,
            "sudoers_ok": host.sudoers_ok,
        }


@router.post("/import")
async def import_hosts_csv(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Import hosts from a CSV file. Skips duplicates."""
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    text = content.decode("utf-8-sig")  # utf-8-sig strips BOM from Excel-generated CSVs
    reader = csv.DictReader(io.StringIO(text))

    required_fields = {"hostname", "ip_address", "username", "os_type"}
    if not reader.fieldnames or not required_fields.issubset(set(reader.fieldnames)):
        raise HTTPException(
            status_code=400,
            detail=f"CSV must have columns: {', '.join(sorted(required_fields))}",
        )

    created = 0
    skipped = 0
    errors = []

    for i, row in enumerate(reader, start=2):
        hostname = row.get("hostname", "").strip()
        ip_address = row.get("ip_address", "").strip()
        username = row.get("username", "").strip()
        os_type = row.get("os_type", "").strip()

        if not all([hostname, ip_address, username, os_type]):
            errors.append(f"Row {i}: missing required fields")
            continue

        if os_type not in VALID_OS_TYPES:
            errors.append(f"Row {i}: invalid os_type '{os_type}'")
            continue

        existing = await db.execute(select(HostModel).where(HostModel.hostname == hostname))
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        is_patch_target = row.get("is_patch_target", "true").strip().lower() in ("true", "1", "yes")
        has_docker = row.get("has_docker", "false").strip().lower() in ("true", "1", "yes")

        host = HostModel(
            hostname=hostname,
            ip_address=ip_address,
            username=username,
            os_type=os_type,
            is_patch_target=is_patch_target,
            has_docker=has_docker,
        )
        db.add(host)
        created += 1

    await db.commit()
    logger.info(f"CSV import: {created} created, {skipped} skipped, {len(errors)} errors")
    return {"created": created, "skipped": skipped, "errors": errors}
