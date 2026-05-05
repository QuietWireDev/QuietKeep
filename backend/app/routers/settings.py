# QuietKeep: routers/settings.py
# Application settings CRUD, SSH key management, pre-flight checks,
# and deploy-key-to-host functionality.
# Author: QuietWire (Dennis Ayotte)

import logging
import platform
from pathlib import Path

import asyncssh
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_config
from app.database import get_db
from app.models import AppSettingModel, HostModel
from app.services.scheduler import reschedule_jobs
from app.ssh.client import deploy_public_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _read_version() -> str:
    for p in (Path("/app/VERSION"), Path(__file__).resolve().parents[3] / "VERSION"):
        if p.is_file():
            return p.read_text().strip()
    return "unknown"


# Defaults for settings not yet stored in DB (first-run state).
# Once a user changes a setting, it's persisted in app_settings table.
DEFAULTS = {
    "theme": "system",
    "ssh_key_path": app_config.ssh_key_path,
    "ssh_timeout": "15",
    "scan_interval_hours": "6",
    "docker_scan_interval_hours": "6",
    "auto_scan_enabled": "true",
    "app_version": _read_version(),
}


class SettingsResponse(BaseModel):
    theme: str
    ssh_key_path: str
    ssh_timeout: int
    scan_interval_hours: int
    docker_scan_interval_hours: int
    auto_scan_enabled: bool
    app_version: str


class SettingsUpdate(BaseModel):
    theme: str | None = None
    ssh_key_path: str | None = None
    ssh_timeout: int | None = None
    scan_interval_hours: int | None = None
    docker_scan_interval_hours: int | None = None
    auto_scan_enabled: bool | None = None


async def get_all_settings(db: AsyncSession) -> dict[str, str]:
    """Load all settings from DB, filling in defaults for missing keys."""
    result = await db.execute(select(AppSettingModel))
    rows = {r.key: r.value for r in result.scalars().all()}
    merged = {**DEFAULTS, **rows}
    return merged


def settings_to_response(raw: dict[str, str]) -> SettingsResponse:
    return SettingsResponse(
        theme=raw["theme"],
        ssh_key_path=raw["ssh_key_path"],
        ssh_timeout=int(raw["ssh_timeout"]),
        scan_interval_hours=int(raw["scan_interval_hours"]),
        docker_scan_interval_hours=int(raw["docker_scan_interval_hours"]),
        auto_scan_enabled=raw["auto_scan_enabled"].lower() in ("true", "1", "yes"),
        app_version=raw["app_version"],
    )


@router.get("/preflight")
async def preflight_check(db: AsyncSession = Depends(get_db)):
    """Run pre-flight system checks and return results."""
    checks = []

    # Python version
    py_ver = platform.python_version()
    py_ok = tuple(int(x) for x in py_ver.split(".")[:2]) >= (3, 11)
    checks.append({"name": "Python", "status": "ok" if py_ok else "warn", "detail": f"Python {py_ver}", "required": "3.11+"})

    # SSH key - check configured path from settings, then env var default, then scan /app/ssh/
    ssh_mount = Path("/app/ssh")
    common_keys = ["id_ed25519", "id_rsa", "id_ecdsa"]
    found_key = None
    try:
        raw = await get_all_settings(db)
        configured_path = Path(raw.get("ssh_key_path", "")).expanduser()
        if configured_path.exists():
            found_key = str(configured_path)
    except Exception:
        pass
    # Fallback: env var default path
    if not found_key:
        try:
            env_path = Path(app_config.ssh_key_path)
            if env_path.exists():
                found_key = str(env_path)
        except OSError:
            pass
    # Fallback: scan mounted SSH directory
    if not found_key:
        try:
            if ssh_mount.exists():
                for name in common_keys:
                    if (ssh_mount / name).exists():
                        found_key = str(ssh_mount / name)
                        break
        except OSError:
            pass
    if found_key:
        checks.append({"name": "SSH Key", "status": "ok", "detail": found_key, "required": "Any SSH key in /app/ssh/"})
    else:
        checks.append({"name": "SSH Key", "status": "warn", "detail": "No SSH key found. Configure one in Settings", "required": "Any SSH key in /app/ssh/"})

    # OS info
    try:
        os_info = platform.freedesktop_os_release()
        os_name = f"{os_info.get('NAME', 'Unknown')} {os_info.get('VERSION_ID', '')}"
    except (OSError, AttributeError):
        os_name = f"{platform.system()} {platform.release()}"
    checks.append({"name": "Operating System", "status": "ok", "detail": os_name, "required": "Ubuntu 22.04+ / Debian 12+"})

    all_ok = all(c["status"] in ("ok", "info") for c in checks)
    return {"checks": checks, "all_ok": all_ok}


@router.get("/setup-script")
async def download_setup_script():
    """Download the host setup script."""
    script_path = Path(__file__).parent.parent.parent.parent / "deploy" / "setup-host.sh"
    if not script_path.exists():
        raise HTTPException(status_code=404, detail="Setup script not found")
    return FileResponse(
        path=str(script_path),
        filename="setup-host.sh",
        media_type="application/x-sh",
    )


@router.get("/ssh-detect-keys")
async def detect_ssh_keys():
    """Scan /app/ssh/ for existing SSH keys and return found paths."""
    ssh_mount = Path("/app/ssh")
    common_keys = ["id_ed25519", "id_rsa", "id_ecdsa", "id_ed25519_quietkeep"]
    found = []
    if ssh_mount.exists():
        for name in common_keys:
            key_path = ssh_mount / name
            if key_path.exists():
                found.append(str(key_path))
    return {"keys": found, "recommended": found[0] if found else None}


def _resolve_public_key(key_path: Path) -> str:
    """
    Return the public key string for a given private key path.
    Checks for an adjacent .pub file first. If not found, derives
    the public key directly from the private key so that users only
    need to docker cp the private key file.
    """
    pub_path = Path(str(key_path) + ".pub")
    if pub_path.exists():
        return pub_path.read_text().strip()

    if not key_path.exists():
        raise FileNotFoundError(f"Private key not found: {key_path}")

    key = asyncssh.read_private_key(str(key_path))
    return key.export_public_key("openssh").decode().strip()


@router.get("/ssh-public-key")
async def get_ssh_public_key(db: AsyncSession = Depends(get_db)):
    """Return the SSH public key for easy copying to managed hosts."""
    raw = await get_all_settings(db)
    key_path = Path(raw["ssh_key_path"]).expanduser()

    try:
        public_key = _resolve_public_key(key_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {"public_key": public_key, "path": str(key_path)}


@router.get("", response_model=SettingsResponse)
async def read_settings(db: AsyncSession = Depends(get_db)):
    """Get all application settings."""
    raw = await get_all_settings(db)
    return settings_to_response(raw)


@router.put("", response_model=SettingsResponse)
async def update_settings(data: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    """Update application settings. Only provided fields are changed."""
    updates = data.model_dump(exclude_unset=True)

    # Validate SSH key path exists
    if "ssh_key_path" in updates:
        key_path = Path(updates["ssh_key_path"]).expanduser()
        if not key_path.exists():
            raise HTTPException(status_code=400, detail=f"SSH key not found: {updates['ssh_key_path']}")

    # Validate scan intervals (1-48 hours)
    for field in ("scan_interval_hours", "docker_scan_interval_hours"):
        if field in updates:
            val = updates[field]
            if not (1 <= val <= 48):
                raise HTTPException(status_code=400, detail=f"{field} must be between 1 and 48 hours")

    # Validate SSH timeout (1-120 seconds)
    if "ssh_timeout" in updates:
        if not (1 <= updates["ssh_timeout"] <= 120):
            raise HTTPException(status_code=400, detail="SSH timeout must be between 1 and 120 seconds")

    # Validate theme
    if "theme" in updates:
        if updates["theme"] not in ("light", "dark", "system"):
            raise HTTPException(status_code=400, detail="Theme must be light, dark, or system")

    for key, value in updates.items():
        str_value = str(value).lower() if isinstance(value, bool) else str(value)

        existing = await db.execute(select(AppSettingModel).where(AppSettingModel.key == key))
        row = existing.scalar_one_or_none()
        if row:
            row.value = str_value
        else:
            db.add(AppSettingModel(key=key, value=str_value))

    await db.commit()
    logger.info(f"Settings updated: {list(updates.keys())}")

    # Read the post-commit settings once and reuse for both the scheduler
    # live-reload (if needed) and the response body. Previously this was
    # fetched twice which is a pointless round-trip.
    raw = await get_all_settings(db)

    # Live-reload scheduler without restart. Changing scan interval or toggling
    # auto-scan takes effect immediately. No need to restart the container.
    if "scan_interval_hours" in updates or "docker_scan_interval_hours" in updates or "auto_scan_enabled" in updates:
        reschedule_jobs(
            scan_hours=int(raw["scan_interval_hours"]),
            docker_hours=int(raw["docker_scan_interval_hours"]),
            enabled=raw["auto_scan_enabled"].lower() in ("true", "1", "yes"),
        )

    return settings_to_response(raw)


class SSHKeyUploadRequest(BaseModel):
    key_content: str


@router.post("/upload-ssh-key")
async def upload_ssh_key(data: SSHKeyUploadRequest, db: AsyncSession = Depends(get_db)):
    """
    Accept a private SSH key and write it to /app/ssh/id_ed25519_quietkeep.
    Written by the backend process (quietkeep user) so ownership is correct.
    The .pub file is derived automatically. Users only need to paste the private key.
    Also updates the ssh_key_path setting so the rest of the app finds it immediately.
    """
    key_content = data.key_content.strip()

    if not key_content.startswith("-----BEGIN"):
        raise HTTPException(status_code=400, detail="Invalid key format. Paste a PEM-encoded SSH private key.")

    ssh_dir = Path("/app/ssh")
    if not ssh_dir.exists():
        raise HTTPException(status_code=500, detail="SSH key directory not found. Check that the quietkeep-ssh volume is mounted.")

    key_path = ssh_dir / "id_ed25519_quietkeep"

    # Write the private key first so asyncssh can read it back to derive the public key
    try:
        key_path.write_text(key_content + "\n")
        key_path.chmod(0o600)
    except PermissionError:
        raise HTTPException(
            status_code=500,
            detail="Cannot write key file. An existing key in the volume is owned by a different user. "
                   "Remove it with: docker exec <container> rm /app/ssh/id_ed25519_quietkeep",
        )

    try:
        key = asyncssh.read_private_key(str(key_path))
        pub_key = key.export_public_key("openssh").decode().strip()
    except Exception as exc:
        key_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Could not parse key: {exc}")

    pub_path = Path(str(key_path) + ".pub")
    pub_path.write_text(pub_key + "\n")
    pub_path.chmod(0o644)

    # Update the ssh_key_path setting so the rest of the app finds the key immediately
    existing = await db.execute(select(AppSettingModel).where(AppSettingModel.key == "ssh_key_path"))
    row = existing.scalar_one_or_none()
    if row:
        row.value = str(key_path)
    else:
        db.add(AppSettingModel(key="ssh_key_path", value=str(key_path)))
    await db.commit()

    logger.info("SSH key uploaded via web UI and written to %s", key_path)
    return {"success": True, "public_key": pub_key, "path": str(key_path)}


@router.post("/generate-ssh-key")
async def generate_ssh_key(db: AsyncSession = Depends(get_db)):
    """
    Generate a new Ed25519 SSH key pair inside the container at /app/ssh/id_ed25519_quietkeep.
    Returns the public key so the user can deploy it to hosts.
    Will NOT overwrite an existing key (returns error if one already exists).
    """
    ssh_dir = Path("/app/ssh")
    key_path = ssh_dir / "id_ed25519_quietkeep"

    if key_path.exists():
        raise HTTPException(
            status_code=409,
            detail="SSH key already exists. Delete it first if you want to regenerate.",
        )

    if not ssh_dir.exists():
        raise HTTPException(status_code=500, detail="SSH key directory not found.")

    try:
        key = asyncssh.generate_private_key("ssh-ed25519")
        key_path.write_bytes(key.export_private_key("openssh"))
        key_path.chmod(0o600)

        pub_key = key.export_public_key("openssh").decode().strip()
        pub_path = Path(str(key_path) + ".pub")
        pub_path.write_text(pub_key + "\n")
        pub_path.chmod(0o644)
    except Exception as exc:
        key_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Key generation failed: {exc}")

    # Update ssh_key_path setting
    existing = await db.execute(select(AppSettingModel).where(AppSettingModel.key == "ssh_key_path"))
    row = existing.scalar_one_or_none()
    if row:
        row.value = str(key_path)
    else:
        db.add(AppSettingModel(key="ssh_key_path", value=str(key_path)))
    await db.commit()

    logger.info("SSH key generated at %s", key_path)
    return {"success": True, "public_key": pub_key, "path": str(key_path)}


class DeployKeyRequest(BaseModel):
    host_id: int
    password: str


@router.post("/deploy-public-key")
async def deploy_key_to_host(data: DeployKeyRequest, db: AsyncSession = Depends(get_db)):
    """
    Deploy QuietKeep's public key to a host using password authentication.
    The password is used only for this single operation and is never stored or logged.
    """
    host = await db.get(HostModel, data.host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    raw = await get_all_settings(db)
    key_path = Path(raw.get("ssh_key_path", app_config.ssh_key_path))

    try:
        pub_key_content = _resolve_public_key(key_path)
    except FileNotFoundError:
        raise HTTPException(
            status_code=400,
            detail="SSH key not found. Load your key first (see SSH Setup Guide in Settings > SSH).",
        )

    success, message = await deploy_public_key(
        host=host.ip_address,
        username=host.username,
        password=data.password,
        pub_key_content=pub_key_content,
    )

    return {"success": success, "message": message, "host_id": data.host_id}
