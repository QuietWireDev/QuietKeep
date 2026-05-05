# QuietKeep: models.py
# SQLAlchemy ORM models and Pydantic request/response schemas.
# ORM models define the database schema; Pydantic schemas handle API serialization.
# Author: QuietWire (Dennis Ayotte)

import json
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


# ─── SQLAlchemy ORM Models ───────────────────────────────────────────────────


class AdminUserModel(Base):
    __tablename__ = "admin_user"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String, unique=True, nullable=False, default="admin")
    password_hash = Column(String, nullable=False)
    totp_secret = Column(String, nullable=True)
    totp_enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, nullable=False)


class HostModel(Base):
    __tablename__ = "hosts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    hostname = Column(String, unique=True, nullable=False)
    ip_address = Column(String, nullable=False)
    username = Column(String, nullable=False)
    os_type = Column(String, nullable=False)  # 'apt', 'pacman', 'proxmox'
    is_online = Column(Boolean, default=False)
    last_scan = Column(DateTime, nullable=True)
    pending_updates = Column(Integer, default=0)
    reboot_required = Column(Boolean, default=False)
    is_patch_target = Column(Boolean, default=True)  # False = monitor only (no patch/reboot buttons)
    has_docker = Column(Boolean, default=False)  # Only Docker-enabled hosts are scanned for stacks
    # NOPASSWD sudoers status. None = never probed, True = probe passed,
    # False = probe failed (missing rule or wrong pattern). Checked on every
    # scan via `sudo -n <quietkeep-cmd> --help` which exits 0 iff NOPASSWD is
    # configured for the binaries QuietKeep drives.
    sudoers_ok = Column(Boolean, nullable=True, default=None)
    sudoers_last_checked = Column(DateTime, nullable=True)
    # Packages the last `apt-get upgrade` refused to install because doing so
    # would pull in new versioned subpackages (the classic "kept back"
    # behavior on Ubuntu/Debian kernel metapackages). Stored as a JSON array
    # of package name strings. NULL or "[]" means nothing held back. The
    # `install-held-back` endpoint runs `upgrade --with-new-pkgs` to bring
    # these in and clears this field on success. Set by patcher.py after
    # every patch run so the UI can surface a follow-up action.
    held_back_packages = Column(Text, nullable=True, default=None)
    # Absolute UTC timestamp of the host's last boot. Computed during each
    # scan from /proc/uptime (seconds since boot) so storage is timezone-safe
    # and the UI can render live uptime as now-last_boot_at without needing
    # fresh scan data. NULL when the host has never scanned successfully or
    # the uptime probe failed.
    last_boot_at = Column(DateTime, nullable=True, default=None)
    # Running kernel version from `uname -r`. Updated on every scan. NULL
    # when the host has never been scanned or the probe failed.
    kernel_version = Column(String, nullable=True, default=None)
    # Human-readable OS name from /etc/os-release PRETTY_NAME, e.g.
    # "Ubuntu 24.04.1 LTS" or "Debian GNU/Linux 12 (bookworm)". Updated
    # on every scan. NULL when the host has never been scanned or the
    # file was missing/unreadable.
    os_pretty_name = Column(String, nullable=True, default=None)

    packages = relationship("PackageModel", back_populates="host", cascade="all, delete-orphan")
    patch_history = relationship("PatchHistoryModel", back_populates="host", cascade="all, delete-orphan")
    docker_stacks = relationship("DockerStackModel", back_populates="host", cascade="all, delete-orphan")


class PackageModel(Base):
    __tablename__ = "packages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Indexed: every package lookup is scoped by host_id (detail view, scan refresh).
    host_id = Column(Integer, ForeignKey("hosts.id"), nullable=False, index=True)
    package_name = Column(String, nullable=False)
    current_version = Column(String, nullable=True)
    available_version = Column(String, nullable=True)
    scan_timestamp = Column(DateTime, default=datetime.utcnow)

    host = relationship("HostModel", back_populates="packages")


class PatchHistoryModel(Base):
    __tablename__ = "patch_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Indexed: history list is always filtered by host_id and sorted by started_at.
    # Separate indexes (not composite) because retention cleanup scans across hosts
    # by started_at alone.
    host_id = Column(Integer, ForeignKey("hosts.id"), nullable=False, index=True)
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String, default="running")  # 'running', 'success', 'failed'
    packages_updated = Column(Integer, default=0)
    log_output = Column(Text, nullable=True)

    host = relationship("HostModel", back_populates="patch_history")


class DockerStackModel(Base):
    __tablename__ = "docker_stacks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Indexed: stacks list and Docker dashboard both group by host_id.
    host_id = Column(Integer, ForeignKey("hosts.id"), nullable=False, index=True)
    stack_name = Column(String, nullable=False)
    compose_path = Column(String, nullable=True)
    status = Column(String, default="unknown")  # 'running', 'stopped', 'unknown'
    container_count = Column(Integer, default=0)
    has_updates = Column(Boolean, default=False)
    last_scan = Column(DateTime, nullable=True)

    # Composite index on the upsert key used by docker_scanner. Every scan does
    # a lookup of (host_id, stack_name) before deciding to update or insert.
    __table_args__ = (
        Index("ix_docker_stacks_host_id_stack_name", "host_id", "stack_name"),
    )

    host = relationship("HostModel", back_populates="docker_stacks")
    containers = relationship("DockerContainerModel", back_populates="stack", cascade="all, delete-orphan")
    update_history = relationship("DockerUpdateHistoryModel", back_populates="stack", cascade="all, delete-orphan")


class DockerContainerModel(Base):
    __tablename__ = "docker_containers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # CASCADE: containers are deleted when their parent stack is removed.
    # Indexed: every container lookup is scoped by stack_id.
    stack_id = Column(Integer, ForeignKey("docker_stacks.id", ondelete="CASCADE"), nullable=False, index=True)
    container_name = Column(String, nullable=False)
    image = Column(String, nullable=False)
    current_digest = Column(String, nullable=True)
    latest_digest = Column(String, nullable=True)
    has_update = Column(Boolean, default=False)
    status = Column(String, default="unknown")  # 'running', 'stopped', 'exited'

    # Composite index on the upsert key used by docker_scanner when matching
    # existing containers to discovered ones during a scan.
    __table_args__ = (
        Index("ix_docker_containers_stack_id_container_name", "stack_id", "container_name"),
    )

    stack = relationship("DockerStackModel", back_populates="containers")


class DockerUpdateHistoryModel(Base):
    __tablename__ = "docker_update_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # CASCADE: history is tied to the stack. Upsert pattern preserves stack IDs
    # across scans so history is never accidentally wiped (see BUG-002 fix).
    # Indexed: history list is always filtered by stack_id and sorted by started_at.
    stack_id = Column(Integer, ForeignKey("docker_stacks.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String, default="running")  # 'running', 'success', 'failed'
    images_updated = Column(Integer, default=0)
    log_output = Column(Text, nullable=True)

    stack = relationship("DockerStackModel", back_populates="update_history")


# Key-value store for user-configurable settings (SSH path, scan interval, theme, etc.).
# Settings router reads/writes these; scheduler reloads interval changes live.
class AppSettingModel(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)


# ─── Pydantic Schemas ────────────────────────────────────────────────────────


class HostBase(BaseModel):
    hostname: str
    ip_address: str
    username: str
    os_type: str
    is_patch_target: bool = True
    has_docker: bool = False


class HostCreate(HostBase):
    """Schema for creating a new host."""
    pass


class HostUpdate(BaseModel):
    """Schema for updating a host. All fields optional."""
    hostname: Optional[str] = None
    ip_address: Optional[str] = None
    username: Optional[str] = None
    os_type: Optional[str] = None
    is_patch_target: Optional[bool] = None
    has_docker: Optional[bool] = None


class HostResponse(HostBase):
    id: int
    is_online: bool
    last_scan: Optional[datetime] = None
    pending_updates: int = 0
    reboot_required: bool = False
    sudoers_ok: Optional[bool] = None
    sudoers_last_checked: Optional[datetime] = None
    # Absolute UTC timestamp of the host's last boot, populated by the scan.
    # Frontends compute live uptime as now-last_boot_at without needing fresh
    # scan data. NULL when the host has never scanned successfully or when
    # the /proc/uptime probe did not return a usable value.
    last_boot_at: Optional[datetime] = None
    # Running kernel version string from `uname -r`, e.g. "6.8.0-45-generic".
    kernel_version: Optional[str] = None
    # Human-readable OS name from /etc/os-release PRETTY_NAME.
    os_pretty_name: Optional[str] = None
    # Decoded list of package names the last patch left held back. Empty
    # list when nothing is deferred. The ORM stores this as a JSON-encoded
    # string (or NULL); _decode_held_back turns that back into a list so
    # the API returns proper JSON to the frontend.
    held_back_packages: list[str] = []

    @field_validator("held_back_packages", mode="before")
    @classmethod
    def _decode_held_back(cls, v):
        if v is None or v == "":
            return []
        if isinstance(v, list):
            return v
        try:
            decoded = json.loads(v)
            return decoded if isinstance(decoded, list) else []
        except (json.JSONDecodeError, TypeError):
            return []

    class Config:
        from_attributes = True


# Request body for the sudoers-fix endpoint. Password is sent over HTTPS
# to the backend, used once to install /etc/sudoers.d/quietkeep-<user>,
# and never persisted to disk or logs.
class SudoersFixRequest(BaseModel):
    password: str


class PackageResponse(BaseModel):
    id: int
    host_id: int
    package_name: str
    current_version: Optional[str] = None
    available_version: Optional[str] = None
    scan_timestamp: Optional[datetime] = None

    class Config:
        from_attributes = True


class HostDetailResponse(HostResponse):
    packages: list[PackageResponse] = []


class PatchHistoryResponse(BaseModel):
    id: int
    host_id: int
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    status: str
    packages_updated: int = 0
    log_output: Optional[str] = None

    class Config:
        from_attributes = True


class DashboardResponse(BaseModel):
    total_hosts: int
    hosts_online: int
    hosts_with_updates: int
    total_pending_packages: int
    hosts_needing_reboot: int
    last_scan: Optional[datetime] = None


class PatchRequest(BaseModel):
    host_ids: list[int]


# ─── Docker Pydantic Schemas ──────────────────────────────────────────────────


class DockerContainerResponse(BaseModel):
    id: int
    stack_id: int
    container_name: str
    image: str
    current_digest: Optional[str] = None
    latest_digest: Optional[str] = None
    has_update: bool = False
    status: str = "unknown"

    class Config:
        from_attributes = True


class DockerStackResponse(BaseModel):
    id: int
    host_id: int
    stack_name: str
    compose_path: Optional[str] = None
    status: str = "unknown"
    container_count: int = 0
    has_updates: bool = False
    last_scan: Optional[datetime] = None
    hostname: Optional[str] = None
    host_ip: Optional[str] = None

    class Config:
        from_attributes = True


class DockerStackDetailResponse(DockerStackResponse):
    containers: list[DockerContainerResponse] = []


class DockerUpdateHistoryResponse(BaseModel):
    id: int
    stack_id: int
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    status: str
    images_updated: int = 0
    log_output: Optional[str] = None

    class Config:
        from_attributes = True


class DockerDashboardResponse(BaseModel):
    total_stacks: int
    stacks_with_updates: int
    total_containers: int
    containers_with_updates: int
    docker_hosts: int
    last_scan: Optional[datetime] = None
