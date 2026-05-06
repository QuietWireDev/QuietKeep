# QuietKeep: ssh/client.py
# Centralized SSH client for all remote operations (scan, patch, reboot, deploy key).
# Uses asyncssh for non-blocking connections. All hosts use key-based auth;
# password auth is only used once during initial key deployment.
# Author: QuietWire (Dennis Ayotte)

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

import asyncssh

from app.config import settings

logger = logging.getLogger(__name__)


class SSHClient:
    """Manages SSH connections to remote hosts."""

    def __init__(self):
        self.key_path = settings.ssh_key_path
        self.timeout = settings.ssh_timeout

    class _Connection:
        """Async context manager wrapping a single asyncssh connection."""

        def __init__(self, host: str, username: str, key_path: str, timeout: int):
            self._host = host
            self._username = username
            self._key_path = key_path
            self._timeout = timeout
            self._conn: Optional[asyncssh.SSHClientConnection] = None

        async def __aenter__(self):
            self._conn = await asyncssh.connect(
                self._host,
                username=self._username,
                client_keys=[self._key_path],
                known_hosts=None,
                connect_timeout=self._timeout,
                config=False,
            )
            return self

        async def __aexit__(self, *exc):
            if self._conn:
                self._conn.close()
                await self._conn.wait_closed()
            return False

        async def run(self, command: str, timeout: Optional[int] = None) -> tuple[bool, str, str]:
            """Run a command on this open connection."""
            timeout = timeout or self._timeout * 4
            try:
                result = await asyncio.wait_for(
                    self._conn.run(command, check=False),
                    timeout=timeout,
                )
                return True, result.stdout or "", result.stderr or ""
            except asyncio.TimeoutError:
                return False, "", "Command timed out"
            except asyncssh.Error as e:
                return False, "", str(e)

    def connect(self, host: str, username: str, timeout: Optional[int] = None) -> "SSHClient._Connection":
        """Open a reusable SSH connection. Use as: async with ssh_client.connect(...) as conn:"""
        return self._Connection(host, username, self.key_path, timeout or self.timeout)

    async def run_command(
        self,
        host: str,
        username: str,
        command: str,
        timeout: Optional[int] = None,
    ) -> tuple[bool, str, str]:
        """
        Execute a command on a remote host via SSH.

        Returns:
            (success, stdout, stderr)
        """
        timeout = timeout or self.timeout
        try:
            async with asyncssh.connect(
                host,
                username=username,
                client_keys=[self.key_path],
                known_hosts=None,
                connect_timeout=timeout,
                config=False,
            ) as conn:
                # Command timeout is 4x connect timeout because long operations
                # (apt upgrade, docker pull) need more time than the initial connection.
                result = await asyncio.wait_for(
                    conn.run(command, check=False),
                    timeout=timeout * 4,
                )
                return True, result.stdout or "", result.stderr or ""
        except asyncssh.Error as e:
            logger.error(f"SSH error connecting to {host}: {e}")
            return False, "", str(e)
        except asyncio.TimeoutError:
            logger.error(f"SSH timeout connecting to {host}")
            return False, "", "Connection timed out"
        except OSError as e:
            logger.error(f"OS error connecting to {host}: {e}")
            return False, "", str(e)

    async def check_connectivity(self, host: str, username: str) -> bool:
        """Check if a host is reachable via SSH."""
        success, _, _ = await self.run_command(host, username, "echo ok", timeout=10)
        return success

    async def check_reboot_required_on(self, conn: "SSHClient._Connection", os_type: str) -> bool:
        """Check reboot status on an open connection."""
        if os_type in ("apt", "proxmox", "kali"):
            success, stdout, _ = await conn.run(
                "[ -f /var/run/reboot-required ] && echo REBOOT_NEEDED || echo OK",
                timeout=10,
            )
            return success and "REBOOT_NEEDED" in stdout
        elif os_type == "pacman":
            success, stdout, _ = await conn.run(
                'RUNNING=$(uname -r); INSTALLED=$(pacman -Q linux 2>/dev/null | awk \'{print $2}\' | sed "s/-/./"); if [ "$RUNNING" != "$INSTALLED" ] && [ -n "$INSTALLED" ]; then echo REBOOT_NEEDED; else echo OK; fi',
                timeout=10,
            )
            return success and "REBOOT_NEEDED" in stdout
        return False

    async def check_reboot_required(self, host: str, username: str, os_type: str) -> bool:
        """Check if a host needs a reboot after updates."""
        if os_type in ("apt", "proxmox", "kali"):
            success, stdout, _ = await self.run_command(
                host, username,
                "[ -f /var/run/reboot-required ] && echo REBOOT_NEEDED || echo OK",
                timeout=10,
            )
            return success and "REBOOT_NEEDED" in stdout
        elif os_type == "pacman":
            # Compare running kernel to installed kernel
            success, stdout, _ = await self.run_command(
                host, username,
                'RUNNING=$(uname -r); INSTALLED=$(pacman -Q linux 2>/dev/null | awk \'{print $2}\' | sed "s/-/./"); if [ "$RUNNING" != "$INSTALLED" ] && [ -n "$INSTALLED" ]; then echo REBOOT_NEEDED; else echo OK; fi',
                timeout=10,
            )
            return success and "REBOOT_NEEDED" in stdout
        return False

    async def probe_sudoers_on(self, conn: "SSHClient._Connection", username: str, os_type: str) -> tuple[bool, bool]:
        """Probe sudoers on an open connection. Returns (is_online, sudoers_ok)."""
        if os_type == "pacman":
            probe_cmd = (
                "sudo -n /usr/bin/pacman --version >/dev/null 2>&1 && "
                "sudo -n /usr/sbin/reboot --help >/dev/null 2>&1 && echo OK"
            )
        else:
            probe_cmd = (
                "sudo -n /usr/bin/apt-get --version >/dev/null 2>&1 && "
                "sudo -n /usr/sbin/reboot --help >/dev/null 2>&1 && echo OK"
            )
        if username == "root":
            probe_cmd = "echo OK"

        success, stdout, _ = await conn.run(probe_cmd, timeout=10)
        if not success:
            return False, False
        ok = "OK" in stdout
        if username == "root":
            return ok, ok
        return True, ok

    async def get_last_boot_on(self, conn: "SSHClient._Connection") -> Optional[datetime]:
        """Get boot time on an open connection."""
        success, stdout, _ = await conn.run("cat /proc/uptime", timeout=10)
        if not success:
            return None
        try:
            uptime_seconds = float(stdout.strip().split()[0])
        except (ValueError, IndexError):
            return None
        if uptime_seconds < 0:
            return None
        return datetime.utcnow() - timedelta(seconds=uptime_seconds)

    async def get_kernel_version_on(self, conn: "SSHClient._Connection") -> Optional[str]:
        """Get kernel version on an open connection."""
        success, stdout, _ = await conn.run("uname -r", timeout=10)
        if not success:
            return None
        version = stdout.strip()
        return version if version else None

    async def get_os_pretty_name_on(self, conn: "SSHClient._Connection") -> Optional[str]:
        """Get OS pretty name on an open connection."""
        success, stdout, _ = await conn.run(
            "grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null",
            timeout=10,
        )
        if not success:
            return None
        line = stdout.strip()
        if line.startswith("PRETTY_NAME="):
            value = line[len("PRETTY_NAME="):]
            return value.strip('"').strip("'") or None
        return None

    async def get_last_boot_at(self, host: str, username: str) -> Optional[datetime]:
        """Compute the host's last boot time as a UTC datetime.

        Reads /proc/uptime (seconds since boot, first whitespace-separated
        field) and subtracts it from the current UTC time. This avoids the
        timezone ambiguity of `uptime -s`, which prints its timestamp in
        the target host's local time without labeling it. Every Linux box
        we support (apt, kali, pacman, proxmox) exposes /proc/uptime with
        the same format.

        Returns None when the probe fails (SSH error, permission issue,
        or unexpected content). Callers should treat None as "unknown"
        rather than assume zero uptime.
        """
        success, stdout, _ = await self.run_command(
            host, username, "cat /proc/uptime", timeout=10,
        )
        if not success:
            return None
        try:
            uptime_seconds = float(stdout.strip().split()[0])
        except (ValueError, IndexError):
            logger.warning(f"Unexpected /proc/uptime output from {host}: {stdout!r}")
            return None
        if uptime_seconds < 0:
            return None
        return datetime.utcnow() - timedelta(seconds=uptime_seconds)

    async def get_os_pretty_name(self, host: str, username: str) -> Optional[str]:
        """Return the PRETTY_NAME from /etc/os-release.

        Example output: "Ubuntu 24.04.1 LTS", "Debian GNU/Linux 12 (bookworm)",
        "Kali GNU/Linux Rolling", "Proxmox VE 8.1". Returns None when the
        file is missing, unreadable, or does not contain PRETTY_NAME.
        """
        success, stdout, _ = await self.run_command(
            host, username,
            "grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null",
            timeout=10,
        )
        if not success:
            return None
        # PRETTY_NAME="Ubuntu 24.04.1 LTS" -> Ubuntu 24.04.1 LTS
        line = stdout.strip()
        if line.startswith("PRETTY_NAME="):
            value = line[len("PRETTY_NAME="):]
            return value.strip('"').strip("'") or None
        return None

    async def get_kernel_version(self, host: str, username: str) -> Optional[str]:
        """Return the running kernel version string from `uname -r`.

        Example output: "6.8.0-45-generic" on Ubuntu, "6.6.30-2-lts" on
        Arch/CachyOS, "6.5.13-1-pve" on Proxmox. Returns None when the
        probe fails (SSH error, timeout, or empty output).
        """
        success, stdout, _ = await self.run_command(
            host, username, "uname -r", timeout=10,
        )
        if not success:
            return None
        version = stdout.strip()
        return version if version else None

    async def reboot_host(self, host: str, username: str) -> tuple[bool, str]:
        """
        Trigger a reboot on a remote host.

        Returns (success, message).

        A successful reboot tears down the SSH session mid-command. asyncssh
        raises a connection-level error in that case; we treat it as success.
        If the session stays open and we get a clean exit status back, the
        command did NOT reboot the host (typical cause: sudo rejected the
        command because the user lacks a NOPASSWD entry for /usr/sbin/reboot).
        In that case we surface the failure so the UI does not lie.
        """
        timeout = 10
        try:
            async with asyncssh.connect(
                host,
                username=username,
                client_keys=[self.key_path],
                known_hosts=None,
                connect_timeout=timeout,
                config=False,
            ) as conn:
                result = await asyncio.wait_for(
                    conn.run("sudo -n reboot", check=False),
                    timeout=timeout * 4,
                )
                # If we get here, the session did not drop. The host did not
                # reboot. Log the real output server-side for diagnostics.
                exit_status = result.exit_status if result.exit_status is not None else -1
                detail = (result.stderr or result.stdout or "").strip()
                if not detail:
                    detail = f"sudo reboot exited {exit_status} without rebooting"
                logger.error(f"Reboot did not fire on {host}: exit={exit_status} detail={detail}")
                return False, "Reboot failed; check sudoers configuration"
        except (asyncssh.ConnectionLost, asyncssh.ChannelOpenError):
            # Expected path on a real reboot: server tore the session down
            # mid-command before sending a clean exit.
            return True, "Reboot command sent"
        except asyncssh.Error as e:
            logger.error(f"SSH error rebooting {host}: {e}")
            return False, "SSH connection error"
        except asyncio.TimeoutError:
            # Ambiguous: could be a slow reboot or a stuck sudo prompt. Be
            # conservative and let the operator verify out of band.
            logger.error(f"SSH timeout rebooting {host}")
            return False, "Reboot timed out; verify host state manually"
        except OSError as e:
            logger.error(f"OS error rebooting {host}: {e}")
            return False, "Network error"


    async def probe_sudoers(
        self, host: str, username: str, os_type: str,
    ) -> tuple[bool, bool]:
        """
        Probe the host for both SSH connectivity and NOPASSWD sudoers in a
        single round trip. Returns (is_online, sudoers_ok).

        If the SSH connection itself fails, the host is offline and sudoers
        status is unknown-treated-as-not-ok for this cycle. If SSH works but
        the sudo -n check fails, the host is online but sudoers is bad.

        Root users have no sudoers requirement, so sudoers_ok mirrors
        connectivity.
        """
        if os_type == "pacman":
            probe_cmd = (
                "sudo -n /usr/bin/pacman --version >/dev/null 2>&1 && "
                "sudo -n /usr/sbin/reboot --help >/dev/null 2>&1 && echo OK"
            )
        else:
            # apt, proxmox, kali all use apt-get for patching.
            probe_cmd = (
                "sudo -n /usr/bin/apt-get --version >/dev/null 2>&1 && "
                "sudo -n /usr/sbin/reboot --help >/dev/null 2>&1 && echo OK"
            )

        if username == "root":
            # Root does not need sudoers; a simple echo proves connectivity.
            probe_cmd = "echo OK"

        success, stdout, _ = await self.run_command(
            host, username, probe_cmd, timeout=10,
        )
        if not success:
            return False, False
        ok = "OK" in stdout
        if username == "root":
            return ok, ok
        return True, ok

    async def install_sudoers(
        self,
        host: str,
        username: str,
        password: str,
        os_type: str,
    ) -> tuple[bool, str]:
        """
        Install /etc/sudoers.d/quietkeep-<username> using a one-time password.

        Uses password SSH auth so this works on hosts that do not yet have
        working NOPASSWD. The password is used once on the remote, piped into
        `sudo -S` to elevate, and never stored or logged. The rule matches
        what deploy/setup-host.sh writes, so new and existing hosts converge.
        """
        if username == "root":
            return False, "Root user does not need a sudoers file"

        if os_type == "pacman":
            sudo_cmds = "/usr/bin/pacman *, /usr/sbin/reboot"
        else:
            sudo_cmds = "/usr/bin/apt *, /usr/bin/apt-get *, /usr/sbin/reboot"

        sudoers_line = f"{username} ALL=(ALL) NOPASSWD: {sudo_cmds}\n"
        sudoers_file = f"/etc/sudoers.d/quietkeep-{username}"

        # visudo -cf validates the file before we move it into place. If the
        # syntax is bad, we abort without leaving a broken sudoers that could
        # lock out sudo entirely. Stage in a tempfile owned by the user,
        # validate, then mv with sudo -S.
        # We pass the password on stdin to sudo -S which reads exactly one
        # line. Writing to tmp first avoids needing sudo to create the tmp.
        script = f"""
set -e
TMPF=$(mktemp)
printf '%s' {_shell_quote(sudoers_line)} > "$TMPF"
echo {_shell_quote(password)} | sudo -S -p '' visudo -cf "$TMPF" >/dev/null
echo {_shell_quote(password)} | sudo -S -p '' install -m 440 -o root -g root "$TMPF" {sudoers_file}
rm -f "$TMPF"
echo OK
"""
        try:
            async with asyncssh.connect(
                host,
                username=username,
                password=password,
                known_hosts=None,
                connect_timeout=self.timeout,
                config=False,
                client_keys=[],  # Force password-only auth for this operation
            ) as conn:
                result = await asyncio.wait_for(
                    conn.run(script, check=False),
                    timeout=self.timeout * 4,
                )
                stdout = (result.stdout or "").strip()
                stderr = (result.stderr or "").strip()
                if result.exit_status == 0 and stdout.endswith("OK"):
                    return True, "Sudoers installed"
                # Normalize common failure modes for the UI.
                msg = stderr or stdout or f"sudo install exited {result.exit_status}"
                if "incorrect password" in msg.lower() or "sudo:" in msg.lower() and "password" in msg.lower():
                    return False, "Incorrect password"
                logger.error(f"install_sudoers on {host}: {msg}")
                return False, "Sudoers install failed"
        except asyncssh.PermissionDenied:
            return False, "Authentication failed. Check the username and password"
        except asyncssh.Error as e:
            logger.error(f"SSH error installing sudoers on {host}: {e}")
            return False, "SSH connection error"
        except asyncio.TimeoutError:
            logger.error(f"SSH timeout installing sudoers on {host}")
            return False, "Connection timed out"
        except OSError as e:
            logger.error(f"OS error installing sudoers on {host}: {e}")
            return False, "Network error"


def _shell_quote(value: str) -> str:
    """Quote a string so it is safe as a single-quoted shell argument."""
    return "'" + value.replace("'", "'\\''") + "'"


ssh_client = SSHClient()


async def deploy_public_key(
    host: str,
    username: str,
    password: str,
    pub_key_content: str,
    timeout: int = 15,
) -> tuple[bool, str]:
    """
    Connect to a host using password authentication and append the QuietKeep
    public key to ~/.ssh/authorized_keys. The password is used only for this
    operation and is never stored or logged.
    """
    try:
        async with asyncssh.connect(
            host,
            username=username,
            password=password,
            known_hosts=None,
            connect_timeout=timeout,
            config=False,
            client_keys=[],  # Force password-only auth for key deployment
        ) as conn:
            # Ensure .ssh directory exists with correct permissions
            result = await conn.run('mkdir -p ~/.ssh && chmod 700 ~/.ssh', check=False)
            if result.exit_status != 0:
                return False, "Failed to create .ssh directory on host"

            async with conn.start_sftp_client() as sftp:
                auth_keys_path = '.ssh/authorized_keys'

                # Read existing authorized_keys (may not exist yet)
                try:
                    async with await sftp.open(auth_keys_path, 'rb') as f:
                        raw = await f.read()
                    existing = raw.decode(errors='replace')
                except asyncssh.SFTPError:
                    existing = ''

                key_line = pub_key_content.strip()

                if key_line in existing:
                    return True, "Key already present on this host"

                # Append the key with a clean newline boundary
                new_content = existing.rstrip('\n') + '\n' + key_line + '\n'
                new_content = new_content.lstrip('\n')

                async with await sftp.open(auth_keys_path, 'wb') as f:
                    await f.write(new_content.encode())

                await sftp.chmod(auth_keys_path, 0o600)

        return True, "SSH key deployed successfully"

    except asyncssh.PermissionDenied:
        return False, "Authentication failed. Check the username and password"
    except asyncssh.ConnectionLost:
        return False, "Connection lost during deployment"
    except (asyncssh.Error, asyncio.TimeoutError) as e:
        logger.error(f"SSH key deployment error for {host}: {e}")
        return False, "Connection failed"
    except OSError as e:
        logger.error(f"OS error deploying key to {host}: {e}")
        return False, "Network error"
