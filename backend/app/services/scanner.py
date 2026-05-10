# QuietKeep: services/scanner.py
# Host scanning service. Connects via SSH to check for available system updates.
# Supports apt (Debian/Ubuntu/Proxmox), pacman (Arch/CachyOS), and kali.
# Scans run in parallel (asyncio.gather), each with its own DB session to avoid
# SQLAlchemy async concurrency issues.
# Author: QuietWire (Dennis Ayotte)

import asyncio
import logging
from datetime import datetime

import asyncssh
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models import HostModel, PackageModel
from app.ssh.client import ssh_client

logger = logging.getLogger(__name__)

# Limit concurrent host scans. SQLite WAL allows concurrent readers but only
# one writer at a time. With 18+ hosts all finishing near the same moment,
# the write queue exceeds busy_timeout. 3 concurrent scans keeps throughput
# high while avoiding lock contention.
_scan_semaphore = asyncio.Semaphore(3)


def _parse_apt_output(output: str) -> list[dict]:
    """Parse `apt list --upgradable` output into package dicts."""
    packages = []
    for line in output.strip().splitlines():
        # Skip non-package lines
        if line.startswith("Listing") or not line.strip() or "/" not in line:
            continue
        try:
            # Format: package/source version_available arch [upgradable from: version_current]
            # Example: docker-ce/noble 5:27.1.0-1~ubuntu.24.04~noble amd64 [upgradable from: 5:26.1.0-1~ubuntu.24.04~noble]
            # After split("/", 1), rest = "noble 5:27.1... amd64 [upgradable from: ...]"
            # Words: [0]=source, [1]=available_version, [2]=arch, ...
            name_part, rest = line.split("/", 1)
            package_name = name_part.strip()
            available_version = ""
            current_version = ""
            if "[upgradable from:" in rest:
                mid = rest.split("[upgradable from:")
                parts = mid[0].strip().split()
                available_version = parts[1] if len(parts) > 1 else parts[0] if parts else ""
                current_version = mid[1].strip().rstrip("]")
            else:
                parts = rest.strip().split()
                available_version = parts[1] if len(parts) > 1 else parts[0] if parts else ""
            packages.append({
                "package_name": package_name,
                "current_version": current_version,
                "available_version": available_version,
            })
        except (ValueError, IndexError) as e:
            logger.warning(f"Failed to parse apt line: {line!r} - {e}")
    return packages


def _parse_pacman_output(output: str) -> list[dict]:
    """Parse `checkupdates` or `pacman -Qu` output into package dicts."""
    packages = []
    for line in output.strip().splitlines():
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) >= 4 and parts[2] == "->":
            # checkupdates format: package current_ver -> new_ver
            packages.append({
                "package_name": parts[0],
                "current_version": parts[1],
                "available_version": parts[3],
            })
        elif len(parts) >= 2:
            # pacman -Qu format: package new_ver
            packages.append({
                "package_name": parts[0],
                "current_version": "",
                "available_version": parts[1] if len(parts) > 1 else "",
            })
    return packages


async def _scan_host_task(host_id: int, hostname: str, ip_address: str, username: str, os_type: str) -> dict:
    """Scan a single host using its own DB session to avoid concurrency issues.

    Opens a single SSH connection and reuses it for all probes (package check,
    reboot detection, sudoers, uptime, kernel, OS name). Previous versions
    opened 7 separate connections per scan.

    Guarded by _scan_semaphore to prevent overwhelming SQLite with too many
    concurrent writers.
    """
    async with _scan_semaphore:
        return await _scan_host_impl(host_id, hostname, ip_address, username, os_type)


async def _scan_host_impl(host_id: int, hostname: str, ip_address: str, username: str, os_type: str) -> dict:
    """Actual scan implementation, run under the semaphore."""
    logger.info(f"Scanning {hostname} ({ip_address})...")

    # Open one SSH connection for the entire scan. If this fails, the host
    # is offline and we bail early.
    try:
        async with ssh_client.connect(ip_address, username, timeout=10) as conn:
            # Quick connectivity check on the open connection
            success, _, _ = await conn.run("echo ok", timeout=10)
            if not success:
                raise asyncssh.Error(reason="connectivity check failed")

            # Run the appropriate update check command
            if os_type in ("apt", "proxmox", "kali"):
                # apt update refreshes package index; apt list shows what's upgradable.
                cmd = "sudo apt update -qq 2>/dev/null && apt list --upgradable 2>/dev/null"
                success, stdout, stderr = await conn.run(cmd, timeout=240)
                packages = _parse_apt_output(stdout) if success else []
            elif os_type == "pacman":
                # checkupdates is safer: it uses a temp DB copy so it doesn't lock pacman.
                cmd = "checkupdates 2>/dev/null || pacman -Qu 2>/dev/null"
                success, stdout, stderr = await conn.run(cmd, timeout=240)
                packages = _parse_pacman_output(stdout) if success else []
            else:
                logger.warning(f"Unknown os_type '{os_type}' for {hostname}")
                packages = []

            # All remaining probes run on the same connection
            reboot_needed = await ssh_client.check_reboot_required_on(conn, os_type)
            online, sudoers_ok = await ssh_client.probe_sudoers_on(conn, username, os_type)
            last_boot = await ssh_client.get_last_boot_on(conn)
            kernel_ver = await ssh_client.get_kernel_version_on(conn)
            os_name = await ssh_client.get_os_pretty_name_on(conn)
            disk_pct = await ssh_client.get_disk_usage_on(conn)

    except (asyncssh.Error, asyncio.TimeoutError, OSError) as e:
        logger.warning(f"  {hostname}: offline ({e})")
        async with async_session() as db:
            result = await db.execute(select(HostModel).where(HostModel.id == host_id))
            host = result.scalar_one()
            host.is_online = False
            host.last_scan = datetime.utcnow()
            await db.commit()
        return {"hostname": hostname, "status": "offline", "packages": []}

    # Connection succeeded, persist results
    async with async_session() as db:
        result = await db.execute(select(HostModel).where(HostModel.id == host_id))
        host = result.scalar_one()

        # Full replace: delete all old packages then insert fresh results.
        await db.execute(delete(PackageModel).where(PackageModel.host_id == host_id))

        now = datetime.utcnow()
        for pkg in packages:
            db.add(PackageModel(
                host_id=host_id,
                package_name=pkg["package_name"],
                current_version=pkg["current_version"],
                available_version=pkg["available_version"],
                scan_timestamp=now,
            ))

        host.pending_updates = len(packages)
        host.reboot_required = reboot_needed
        host.is_online = online
        host.sudoers_ok = sudoers_ok
        host.sudoers_last_checked = now
        host.last_scan = now
        if last_boot is not None:
            host.last_boot_at = last_boot
        if kernel_ver is not None:
            host.kernel_version = kernel_ver
        if os_name is not None:
            host.os_pretty_name = os_name
        if disk_pct is not None:
            host.disk_usage_percent = disk_pct
        await db.commit()

    logger.info(f"  {hostname}: {len(packages)} updates available, reboot={'YES' if reboot_needed else 'no'}")
    return {"hostname": hostname, "status": "scanned", "packages": packages}


async def scan_host(host: HostModel, db: AsyncSession) -> dict:
    """Scan a single host for available updates."""
    return await _scan_host_task(host.id, host.hostname, host.ip_address, host.username, host.os_type)


async def scan_all_hosts(db: AsyncSession) -> list[dict]:
    """Scan all hosts in parallel, each with its own DB session."""
    result = await db.execute(select(HostModel))
    hosts = result.scalars().all()

    # Extract host data before launching parallel tasks (avoids sharing ORM objects)
    tasks = [
        _scan_host_task(h.id, h.hostname, h.ip_address, h.username, h.os_type)
        for h in hosts
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    scan_results = []
    for r in results:
        if isinstance(r, Exception):
            logger.error(f"Scan task failed: {r}")
            scan_results.append({"hostname": "unknown", "status": "error", "packages": []})
        else:
            scan_results.append(r)

    return scan_results
