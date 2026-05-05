# QuietKeep: services/docker_updater.py
# Docker stack update service. Pulls latest images and recreates containers
# for a compose stack via SSH.
# Author: QuietWire (Dennis Ayotte)

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models import DockerStackModel, DockerUpdateHistoryModel
from app.ssh.client import ssh_client

logger = logging.getLogger(__name__)


async def update_stack(stack: DockerStackModel, db: AsyncSession) -> DockerUpdateHistoryModel:
    """Pull latest images and recreate containers for a Docker compose stack."""

    host = stack.host
    compose_dir = "/".join(stack.compose_path.split("/")[:-1]) if stack.compose_path else ""

    if not compose_dir:
        history = DockerUpdateHistoryModel(
            stack_id=stack.id,
            started_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
            status="failed",
            log_output="No compose path found for this stack.",
        )
        db.add(history)
        await db.commit()
        return history

    history = DockerUpdateHistoryModel(
        stack_id=stack.id,
        started_at=datetime.utcnow(),
        status="running",
    )
    db.add(history)
    await db.commit()
    await db.refresh(history)

    logger.info(f"Updating Docker stack '{stack.stack_name}' on {host.hostname}...")

    try:
        # Pull new images
        cmd = (
            f'cd "{compose_dir}" && '
            f'docker compose pull 2>&1 && '
            f'docker compose up -d 2>&1'
        )

        success, stdout, stderr = await ssh_client.run_command(
            host.ip_address, host.username, cmd, timeout=300
        )

        history.completed_at = datetime.utcnow()
        history.log_output = stdout + ("\n--- STDERR ---\n" + stderr if stderr.strip() else "")

        if success:
            history.status = "success"
            # Count updated images by looking for "Pulled" or "Recreated" lines.
            # This is an approximation. Docker compose output doesn't give a clean count.
            images_updated = sum(
                1 for line in stdout.splitlines()
                if "pulled" in line.lower() or "recreat" in line.lower()
            )
            history.images_updated = max(images_updated, 0)
            logger.info(f"  {host.hostname}/{stack.stack_name}: updated successfully")
        else:
            history.status = "failed"
            logger.error(f"  {host.hostname}/{stack.stack_name}: update failed")
    except Exception as e:
        history.completed_at = datetime.utcnow()
        history.status = "failed"
        history.log_output = f"Exception during update: {e}"
        logger.error(f"  {host.hostname}/{stack.stack_name}: update exception: {e}")

    await db.commit()
    return history


async def update_stack_by_id(stack_id: int) -> DockerUpdateHistoryModel:
    """Update a Docker stack by its ID.

    Single SELECT with selectinload eagerly loads the parent host so
    update_stack() can reference stack.host without triggering a lazy
    round-trip. Previously this function executed the same SELECT twice
    and then called db.refresh to pull host in; both were redundant.
    """
    async with async_session() as db:
        result = await db.execute(
            select(DockerStackModel)
            .options(selectinload(DockerStackModel.host))
            .where(DockerStackModel.id == stack_id)
        )
        stack = result.scalar_one_or_none()
        if not stack:
            raise ValueError(f"Stack {stack_id} not found")

        return await update_stack(stack, db)
