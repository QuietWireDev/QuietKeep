# QuietKeep: services/patcher.py
# Patch deployment service. Runs OS-specific upgrade commands over SSH and
# parses output to count installed packages and detect failures.
# Author: QuietWire (Dennis Ayotte)

import json
import logging
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import HostModel, PatchHistoryModel
from app.ssh.client import ssh_client

logger = logging.getLogger(__name__)


def parse_held_back(stdout: str) -> list[str]:
    """Extract package names from an apt output's "kept back" section.

    apt prints something like:

        The following packages have been kept back:
          linux-generic linux-headers-generic linux-image-generic
        0 upgraded, 0 newly installed, 0 to remove and 5 not upgraded.

    The list can span multiple indented lines (space-separated within a
    line, continuation lines all start with whitespace). The section ends
    at the first line that does not start with whitespace (typically the
    "0 upgraded" summary line).

    Returns an empty list if no "kept back" header is found. Case-sensitive
    match because apt is deterministic about this header text in English
    locale; non-English locales would need the quotes list expanded.
    """
    lines = stdout.splitlines()
    header = "The following packages have been kept back:"
    packages: list[str] = []
    in_block = False
    for line in lines:
        if not in_block:
            if line.strip() == header:
                in_block = True
            continue
        if not line or not line[0].isspace():
            break
        packages.extend(line.split())
    return packages


async def patch_host(
    host: HostModel,
    db: AsyncSession,
    *,
    include_new_pkgs: bool = False,
) -> PatchHistoryModel:
    """Apply available patches to a single host via SSH.

    When `include_new_pkgs` is False (default), runs plain `apt-get upgrade`.
    This is the conservative mode: only existing packages are upgraded;
    anything that would require installing a new versioned subpackage (e.g.
    a kernel update) gets skipped and the names are captured in
    host.held_back_packages so the UI can surface a follow-up action.

    When `include_new_pkgs` is True, runs `apt-get upgrade --with-new-pkgs`
    so held-back packages (kernel metapackages and similar) do get installed.
    This is the "Install Held-Back Updates" path exposed through a separate
    endpoint so the user has to opt in. Does not switch to dist-upgrade,
    which would also remove packages; --with-new-pkgs will not remove anything.
    Kali stays on dist-upgrade either way because it's a rolling release.
    """

    if not host.is_patch_target:
        logger.warning(f"Skipping {host.hostname} - not a patch target")
        history = PatchHistoryModel(
            host_id=host.id,
            started_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
            status="skipped",
            packages_updated=0,
            log_output=f"{host.hostname} is excluded from patching.",
        )
        db.add(history)
        await db.commit()
        return history

    history = PatchHistoryModel(
        host_id=host.id,
        started_at=datetime.utcnow(),
        status="running",
    )
    db.add(history)
    await db.commit()
    await db.refresh(history)

    # Build the patch command (no SETENV needed, uses apt-get -o flags)
    if host.os_type in ("apt", "proxmox", "kali"):
        # Kali uses dist-upgrade because it's a rolling release. Regular upgrade
        # won't install new packages or remove old ones that dist-upgrade handles.
        # apt/proxmox use plain `upgrade` by default (conservative: no new
        # installs, no removes) and switch to `upgrade --with-new-pkgs` when
        # the caller explicitly asked for held-back packages to come through.
        if host.os_type == "kali":
            apt_action = "dist-upgrade"
        elif include_new_pkgs:
            apt_action = "upgrade --with-new-pkgs"
        else:
            apt_action = "upgrade"
        # --fix-broken install runs before upgrade to complete any half-finished
        # dpkg transactions left over from an interrupted previous run (common
        # on Kali rolling when a mirror times out mid-upgrade). Without this,
        # subsequent upgrades silently do nothing because dpkg is in a wedged
        # state. Signature verification stays on; this only finishes what apt
        # already authenticated previously.
        cmd = (
            'sudo apt-get update -qq 2>&1 && '
            'sudo apt-get -y --fix-broken install 2>&1 && '
            f'sudo apt-get -y --fix-missing -o Dpkg::Options::="--force-confdef" '
            f'-o Dpkg::Options::="--force-confold" {apt_action} 2>&1 && '
            'sudo apt-get -y autoremove 2>&1 && '
            'sudo apt-get clean 2>&1'
        )
    elif host.os_type == "pacman":
        cmd = "sudo pacman -Syu --noconfirm 2>&1 && sudo pacman -Sc --noconfirm 2>&1"
    else:
        history.status = "failed"
        history.completed_at = datetime.utcnow()
        history.log_output = f"Unknown os_type: {host.os_type}"
        await db.commit()
        return history

    logger.info(f"Patching {host.hostname} ({host.ip_address})...")
    try:
        success, stdout, stderr = await ssh_client.run_command(
            host.ip_address, host.username, cmd, timeout=300
        )
    except Exception as e:
        logger.error(f"  {host.hostname}: unexpected error during patch: {e}")
        history.completed_at = datetime.utcnow()
        history.status = "failed"
        history.packages_updated = 0
        history.log_output = f"Unexpected error: {e}"
        await db.commit()
        return history

    history.completed_at = datetime.utcnow()
    history.log_output = stdout + ("\n--- STDERR ---\n" + stderr if stderr.strip() else "")

    # Count "Unpacking" lines instead of apt's summary line because partial
    # failures misreport the total. Each "Unpacking" = one package actually installed.
    installed_count = sum(
        1 for line in stdout.splitlines()
        if line.strip().startswith("Unpacking ")
    )

    # Detect apt download/fetch failures
    has_apt_error = any(
        line.strip().startswith("E: ") for line in stdout.splitlines()
    )

    # Detect GPG / keyring-rotation failures. These are a distinct failure mode
    # from generic apt errors and need operator action (install a fresh
    # keyring). We tag the log so the UI can surface targeted recovery
    # instructions instead of a generic "patch failed" message. We do NOT
    # auto-remediate: trusting a new signing key without operator review would
    # defeat the whole point of GPG verification.
    keyring_markers = (
        "NO_PUBKEY",
        "EXPKEYSIG",
        "KEYEXPIRED",
        "The following signatures couldn't be verified",
        "The following signatures were invalid",
        "is not signed",
    )
    keyring_issue = any(m in stdout or m in stderr for m in keyring_markers)
    if keyring_issue:
        history.log_output = "[QK_KEYRING_ISSUE]\n" + history.log_output

    # Detect sudo-denial failures. When a host is missing its NOPASSWD
    # sudoers entry, sudo prints "a password is required" / "a terminal is
    # required", returns non-zero, and no packages install. Without this
    # check the patcher reported status=success with 0 packages and the
    # operator had no signal that the host is misconfigured.
    combined = f"{stdout}\n{stderr}"
    sudo_denied = (
        "sudo: a password is required" in combined
        or "sudo: a terminal is required" in combined
        or "sudo: no tty present" in combined
    )

    if sudo_denied or (has_apt_error and installed_count == 0):
        success = False

    if success:
        if has_apt_error and installed_count > 0:
            history.status = "partial"
            logger.warning(f"  {host.hostname}: partial patch ({installed_count} installed, some downloads failed)")
        else:
            history.status = "success"
            logger.info(f"  {host.hostname}: patched successfully")

        if host.os_type in ("apt", "proxmox", "kali"):
            count = installed_count
            # Fallback: parse summary lines if no Unpacking lines found
            if count == 0:
                for line in stdout.splitlines():
                    stripped = line.strip()
                    if "upgraded," in stripped and "newly installed" in stripped:
                        try:
                            count = int(stripped.split()[0])
                        except (ValueError, IndexError):
                            pass
                        break
                    if stripped.startswith("Upgrading:") and "," in stripped:
                        try:
                            count = int(stripped.split(":")[1].split(",")[0].strip())
                        except (ValueError, IndexError):
                            pass
                        break
            history.packages_updated = count
        elif host.os_type == "pacman":
            # pacman doesn't report individual install lines like apt does.
            # Use pre-scan pending count as the best available approximation.
            history.packages_updated = host.pending_updates
        logger.info(f"  {host.hostname}: {history.packages_updated} packages updated")
    else:
        history.status = "failed"
        logger.error(f"  {host.hostname}: patching failed")

    # Update the host's held-back package list from the output of this run.
    # Cleared for pacman/kali (dist-upgrade handles everything) and for any
    # run with include_new_pkgs=True (success means held-back packages just
    # got installed). Otherwise parse "kept back" block and persist as JSON.
    # Stored as JSON string so the list round-trips through SQLite TEXT.
    if host.os_type == "pacman" or include_new_pkgs:
        held_back: list[str] = []
    elif host.os_type in ("apt", "proxmox", "kali"):
        held_back = parse_held_back(stdout)
    else:
        held_back = []
    host.held_back_packages = json.dumps(held_back) if held_back else None
    if held_back:
        logger.info(
            f"  {host.hostname}: {len(held_back)} package(s) held back: "
            f"{', '.join(held_back)}"
        )

    await db.commit()
    return history
