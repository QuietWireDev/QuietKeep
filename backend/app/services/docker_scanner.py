# QuietKeep: services/docker_scanner.py
# Docker stack discovery and non-destructive update detection.
# Uses upsert pattern to preserve stack/container IDs across scans (critical
# for keeping update history intact, see BUG-002).
# Update detection compares local RepoDigest vs remote manifest digest without
# pulling any images.
# Author: QuietWire (Dennis Ayotte)

import asyncio
import json
import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models import HostModel, DockerStackModel, DockerContainerModel
from app.ssh.client import ssh_client

logger = logging.getLogger(__name__)

# Limit concurrent Docker scans to avoid SQLite write contention.
_docker_scan_semaphore = asyncio.Semaphore(3)


async def scan_docker_host(host: HostModel, db: AsyncSession) -> dict:
    """Scan a single host for Docker compose stacks and check for image updates."""

    if not host.has_docker:
        return {"hostname": host.hostname, "status": "skipped", "stacks": []}

    # Check connectivity if host isn't already marked online
    if not host.is_online:
        is_online = await ssh_client.check_connectivity(host.ip_address, host.username)
        if is_online:
            host.is_online = True
            await db.commit()
        else:
            return {"hostname": host.hostname, "status": "offline", "stacks": []}

    logger.info(f"Scanning Docker on {host.hostname} ({host.ip_address})...")

    # 1. Discover compose stacks
    success, stdout, stderr = await ssh_client.run_command(
        host.ip_address, host.username,
        "docker compose ls --format json 2>/dev/null",
        timeout=30,
    )

    if not success:
        logger.warning(f"  {host.hostname}: docker compose ls failed")
        return {"hostname": host.hostname, "status": "error", "stacks": []}

    try:
        stacks_data = json.loads(stdout) if stdout.strip() else []
    except json.JSONDecodeError:
        logger.warning(f"  {host.hostname}: failed to parse docker compose ls output")
        return {"hostname": host.hostname, "status": "error", "stacks": []}

    # Track which stacks we see this scan (to remove stale ones later)
    seen_stack_names = set()

    scanned_stacks = []
    for stack_info in stacks_data:
        stack_name = stack_info.get("Name", "unknown")
        compose_path = stack_info.get("ConfigFiles", "")
        status_str = stack_info.get("Status", "unknown")

        # Parse status like "running(4)" -> "running", 4
        container_count = 0
        stack_status = status_str
        if "(" in status_str:
            stack_status = status_str.split("(")[0]
            try:
                container_count = int(status_str.split("(")[1].rstrip(")"))
            except (ValueError, IndexError):
                pass

        seen_stack_names.add(stack_name)

        # Upsert: find existing stack by (host_id, stack_name) or create new
        result = await db.execute(
            select(DockerStackModel).where(
                DockerStackModel.host_id == host.id,
                DockerStackModel.stack_name == stack_name,
            )
        )
        stack = result.scalar_one_or_none()

        if stack:
            stack.compose_path = compose_path
            stack.status = stack_status
            stack.container_count = container_count
            stack.last_scan = datetime.utcnow()
        else:
            stack = DockerStackModel(
                host_id=host.id,
                stack_name=stack_name,
                compose_path=compose_path,
                status=stack_status,
                container_count=container_count,
                last_scan=datetime.utcnow(),
            )
            db.add(stack)

        await db.flush()
        await db.refresh(stack)

        # 2. Get containers and their images for this stack
        compose_dir = "/".join(compose_path.split("/")[:-1]) if compose_path else ""
        if compose_dir:
            success, stdout, _ = await ssh_client.run_command(
                host.ip_address, host.username,
                f'cd "{compose_dir}" && docker compose ps --format json 2>/dev/null',
                timeout=30,
            )

            containers_data = []
            if success and stdout.strip():
                # docker compose ps --format json may output one JSON object per line
                for line in stdout.strip().splitlines():
                    line = line.strip()
                    if line.startswith("{"):
                        try:
                            containers_data.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
                    elif line.startswith("["):
                        try:
                            containers_data.extend(json.loads(line))
                        except json.JSONDecodeError:
                            pass

            seen_container_names = set()
            for cdata in containers_data:
                container_name = cdata.get("Name", cdata.get("Service", "unknown"))
                image = cdata.get("Image", "unknown")
                c_status = cdata.get("State", cdata.get("Status", "unknown"))
                seen_container_names.add(container_name)

                # Upsert container by (stack_id, container_name)
                c_result = await db.execute(
                    select(DockerContainerModel).where(
                        DockerContainerModel.stack_id == stack.id,
                        DockerContainerModel.container_name == container_name,
                    )
                )
                existing_container = c_result.scalar_one_or_none()
                if existing_container:
                    existing_container.image = image
                    existing_container.status = c_status
                else:
                    db.add(DockerContainerModel(
                        stack_id=stack.id,
                        container_name=container_name,
                        image=image,
                        status=c_status,
                    ))

            # Remove containers that no longer exist in this stack
            old_containers = await db.execute(
                select(DockerContainerModel).where(
                    DockerContainerModel.stack_id == stack.id,
                    DockerContainerModel.container_name.notin_(seen_container_names) if seen_container_names else True,
                )
            )
            for old_c in old_containers.scalars().all():
                await db.delete(old_c)

        await db.flush()

        # 3. Non-destructive update check: compare local vs remote digests
        has_updates = False
        if compose_dir:
            # Get container name -> image reference + local image ID
            success, stdout, _ = await ssh_client.run_command(
                host.ip_address, host.username,
                f'cd "{compose_dir}" && docker compose ps -q 2>/dev/null | '
                f'xargs -I{{}} docker inspect {{}} --format '
                f"'{{{{.Name}}}}|{{{{index .Config.Image}}}}|{{{{.Image}}}}' 2>/dev/null",
                timeout=30,
            )
            container_images = {}
            if success and stdout.strip():
                for line in stdout.strip().splitlines():
                    parts = line.strip().split("|", 2)
                    if len(parts) >= 3:
                        cname = parts[0].lstrip("/")
                        container_images[cname] = {
                            "image": parts[1],
                            "local_id": parts[2],
                        }

            # For each unique image, compare local RepoDigest vs remote digest
            unique_images = set(v["image"] for v in container_images.values())
            images_with_updates = set()

            if unique_images:
                # Build a script that checks each image non-destructively
                check_cmds = []
                for img in unique_images:
                    # Skip digest-pinned images (e.g., image@sha256:abc...).
                    # These are intentionally frozen by the user and should never
                    # be flagged as having updates.
                    if "@sha256:" in img:
                        continue
                    # Skip locally-built images that have no registry.
                    # Images like "quietkeep-quietkeep:latest" (no "/" in the
                    # name before the tag) are built on the host and have no
                    # upstream to check. Flagging them causes false positives.
                    img_ref = img.split(":")[0]
                    if "/" not in img_ref:
                        continue
                    check_cmds.append(
                        f'LOCAL=$(docker image inspect "{img}" --format '
                        f"'{{{{index .RepoDigests 0}}}}' 2>/dev/null | sed 's/.*@//'); "
                        f'REMOTE=$(docker buildx imagetools inspect "{img}" --raw 2>/dev/null | '
                        f"python3 -c \"import sys,hashlib; d=sys.stdin.buffer.read(); "
                        f"print('sha256:'+hashlib.sha256(d).hexdigest())\" 2>/dev/null); "
                        f'echo "{img}|$LOCAL|$REMOTE"'
                    )

                if check_cmds:
                    full_cmd = " && ".join(check_cmds)
                    success, stdout, _ = await ssh_client.run_command(
                        host.ip_address, host.username, full_cmd, timeout=60,
                    )

                    if success and stdout.strip():
                        for line in stdout.strip().splitlines():
                            parts = line.strip().split("|", 2)
                            if len(parts) >= 3:
                                img, local_d, remote_d = parts
                                if local_d and remote_d and local_d != remote_d:
                                    images_with_updates.add(img)

            # Update per-container info
            result = await db.execute(
                select(DockerContainerModel).where(DockerContainerModel.stack_id == stack.id)
            )
            containers = result.scalars().all()
            for container in containers:
                cname = container.container_name
                info = container_images.get(cname, {})
                local_id = info.get("local_id", "")
                container.current_digest = local_id[:16] if local_id else None

                img = info.get("image", "")
                container.has_update = img in images_with_updates
                if container.has_update:
                    has_updates = True

        stack.has_updates = has_updates
        scanned_stacks.append({
            "stack_name": stack_name,
            "status": stack_status,
            "containers": container_count,
            "has_updates": has_updates,
        })

        # Commit per stack rather than once at end-of-scan. Keeps the SQLite
        # write lock held only during each brief commit, not for the entire
        # 10-30s scan window that is dominated by SSH waits. Matters when
        # many hosts scan in parallel: a long-held write transaction would
        # force other parallel tasks to queue behind it on busy_timeout.
        # Partial state on mid-scan failure is acceptable because each
        # stack's data is self-contained and the next scan reconciles.
        await db.commit()

    # Stale stack cleanup: if a stack was removed from the host (docker compose down),
    # delete it from DB. CASCADE will also remove its containers and update history.
    if seen_stack_names:
        old_stacks = await db.execute(
            select(DockerStackModel).where(
                DockerStackModel.host_id == host.id,
                DockerStackModel.stack_name.notin_(seen_stack_names),
            )
        )
        for old_stack in old_stacks.scalars().all():
            logger.info(f"  {host.hostname}: removing stale stack '{old_stack.stack_name}'")
            await db.delete(old_stack)
        await db.commit()
    logger.info(f"  {host.hostname}: {len(scanned_stacks)} stacks, "
                f"{sum(1 for s in scanned_stacks if s['has_updates'])} with updates")
    return {"hostname": host.hostname, "status": "scanned", "stacks": scanned_stacks}


async def _scan_docker_host_task(host_id: int) -> dict:
    """Scan one host's Docker stacks using its own DB session.

    Mirrors the per-task session pattern in scanner.py _scan_host_task:
    every parallel task owns its own AsyncSession so there is no
    contention over a shared session when asyncio.gather launches many
    scans at once. The host row is re-fetched inside this session rather
    than passed in as an ORM object, which avoids cross-session detach
    errors.

    Guarded by _docker_scan_semaphore to prevent overwhelming SQLite.

    Returns the standard {hostname, status, stacks} shape on success, or
    {"error": "Host not found"} if the host was deleted between the
    caller querying host_ids and this task running. Callers are
    responsible for normalizing the error shape into whatever their
    consumer expects.
    """
    async with _docker_scan_semaphore, async_session() as db:
        result = await db.execute(select(HostModel).where(HostModel.id == host_id))
        host = result.scalar_one_or_none()
        if not host:
            return {"error": "Host not found"}
        return await scan_docker_host(host, db)


async def scan_all_docker_hosts(db: AsyncSession) -> list[dict]:
    """Scan all Docker-enabled hosts for compose stacks in parallel.

    Mirrors scanner.py scan_all_hosts. The passed-in `db` session is used
    ONLY for the initial "which hosts?" query; actual per-host work
    happens in _scan_docker_host_task which opens its own session. This
    prevents the single shared session from becoming a serialization
    point when N hosts are scanned concurrently.

    Uses asyncio.gather(return_exceptions=True) so one failing host
    (unreachable, SSH timeout, malformed docker output) does not prevent
    the rest from completing. Any exception is logged and converted to
    an error entry in the results list.
    """
    result = await db.execute(
        select(HostModel.id).where(HostModel.has_docker == True)
    )
    host_ids = list(result.scalars().all())
    logger.info(f"Scanning Docker on {len(host_ids)} hosts in parallel...")

    tasks = [_scan_docker_host_task(host_id) for host_id in host_ids]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    scan_results = []
    for r in results:
        if isinstance(r, Exception):
            logger.error(f"Docker scan task failed: {r}")
            scan_results.append({"hostname": "unknown", "status": "error", "stacks": []})
        elif isinstance(r, dict) and "error" in r:
            # Host was deleted between listing host IDs and running the
            # task. Race is rare but worth normalizing to the standard
            # error shape so downstream consumers don't special-case it.
            logger.warning(f"Docker scan task skipped (host deleted mid-scan): {r}")
            scan_results.append({"hostname": "unknown", "status": "error", "stacks": []})
        else:
            scan_results.append(r)

    return scan_results


async def scan_docker_host_by_id(host_id: int) -> dict:
    """Scan a single host's Docker stacks by host ID.

    Thin wrapper around _scan_docker_host_task so the single-host API
    endpoint and the parallel scan_all_docker_hosts share identical
    session-and-fetch logic. Preserves the historical {"error": "..."}
    contract that routers/docker.py uses to emit a 404.
    """
    return await _scan_docker_host_task(host_id)
