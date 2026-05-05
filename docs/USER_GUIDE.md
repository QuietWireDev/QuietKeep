# QuietKeep User Guide

A step-by-step guide for installing and using QuietKeep. Written for
users who may be new to Docker, SSH, or Linux server administration.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install QuietKeep](#2-install-quietkeep)
3. [Access the Web UI](#3-access-the-web-ui)
4. [Create Your Admin Account](#4-create-your-admin-account)
5. [First-Run Wizard](#5-first-run-wizard)
6. [Adding Hosts](#6-adding-hosts)
7. [SSH Key Setup](#7-ssh-key-setup)
8. [Deploy Keys to Hosts](#8-deploy-keys-to-hosts)
9. [Sudoers Configuration](#9-sudoers-configuration)
10. [Scanning Hosts](#10-scanning-hosts)
11. [Patching Hosts](#11-patching-hosts)
12. [Docker Stack Management](#12-docker-stack-management)
13. [Diagnostics](#13-diagnostics)
14. [Threat Intelligence](#14-threat-intelligence)
15. [Settings](#15-settings)
16. [Two-Factor Authentication](#16-two-factor-authentication)
17. [Reverse Proxy and SSL](#17-reverse-proxy-and-ssl)
18. [Updating QuietKeep](#18-updating-quietkeep)
19. [Password Reset](#19-password-reset)
20. [Troubleshooting](#20-troubleshooting)

---

## 1. Prerequisites

**QuietKeep server (the machine running QuietKeep):**

- Linux host (Ubuntu 22.04+, Debian 12+, or similar)
- Docker Engine 20.10+ with Compose v2 plugin
- Git
- 2 GB RAM minimum (4 GB recommended)
- Network access to your managed hosts over SSH (port 22)

**Managed hosts (the machines QuietKeep will scan and patch):**

- SSH server running and accessible from the QuietKeep server
- A user account with sudo privileges for package management commands
- Supported OS: Debian/Ubuntu, Kali Linux, Arch/CachyOS, or Proxmox VE
- Docker Engine with Compose v2 plugin (only if you want Docker stack management)

---

## 2. Install QuietKeep

Clone the repository and build with Docker Compose:

```bash
git clone https://github.com/quietwire-dev/QuietKeep.git ~/quietkeep
cd ~/quietkeep
docker compose up -d --build
```

The first build takes a few minutes. Docker builds the image from source,
creates three named volumes (database, certificates, SSH keys), and starts
the container.

QuietKeep listens on:
- **Port 443** (HTTPS, primary)
- **Port 80** (redirects to HTTPS)

The server IP is auto-detected at startup. If you need to override it
(for example, behind a load balancer), set the `QUIETKEEP_HOST` environment
variable in your `docker-compose.yml`.

---

## 3. Access the Web UI

Open a browser and go to `https://YOUR_SERVER_IP`.

### Browser Security Warning

You will see a browser security warning on the first visit. **This is
expected and normal.** QuietKeep generates a self-signed HTTPS certificate
on first startup. Your connection is encrypted, but the browser does not
recognize the certificate authority.

To proceed:

| Browser | Steps |
|---------|-------|
| Chrome / Brave / Edge | Click **Advanced**, then **Proceed to [IP] (unsafe)** |
| Firefox | Click **Advanced**, then **Accept the Risk and Continue** |
| Safari | Click **Show Details**, then **visit this website** |

You only need to do this once per browser. The certificate persists across
container rebuilds because it is stored in a Docker volume.

To eliminate this warning permanently, set up a reverse proxy with a real
SSL certificate. See [Reverse Proxy and SSL](#17-reverse-proxy-and-ssl).

---

## 4. Create Your Admin Account

On the first visit, QuietKeep prompts you to create an admin account.

1. Enter a **username**
2. Enter a **password** (use a strong, unique password)
3. Click **Create Account**

There is no default password. No one can access QuietKeep until you
complete this step.

After account creation, you can optionally enable two-factor authentication.
This is covered in [Two-Factor Authentication](#16-two-factor-authentication).

---

## 5. First-Run Wizard

After login, the first-run wizard walks you through initial setup. The
wizard covers:

1. **Welcome:** overview of what QuietKeep does
2. **Deployment type:** whether you are running on a dedicated server or Docker Desktop
3. **SSH key:** explains why QuietKeep needs SSH access and how to set it up
4. **Permissions:** explains exactly which commands QuietKeep runs and why it needs passwordless sudo
5. **Pre-flight checks:** verifies your SSH key exists and is configured
6. **Add hosts:** add your first hosts manually or import from CSV
7. **Deploy keys:** push the SSH key to your hosts
8. **Done:** summary and automatic first scan

You can skip the wizard if you want to explore the UI first and set things
up later through Settings.

---

## 6. Adding Hosts

You can add hosts during the wizard or any time from **Settings > Hosts**.

### Add Manually

Click **Add Host** and fill in:

| Field | Description | Example |
|-------|-------------|---------|
| Hostname | A display name for the host | `web-server` |
| IP Address | The host's IP or hostname reachable from QuietKeep | `192.168.1.50` |
| Username | SSH user with sudo access | `admin` |
| OS Type | Package manager type | Debian/Ubuntu, Kali, Arch/CachyOS, Proxmox |
| Patch Target | Whether to include in scan/patch operations | Yes/No |
| Has Docker | Whether this host runs Docker Compose stacks | Yes/No |

### Import from CSV

Click **Import CSV** and upload a file with one host per line. Download
the template first to see the expected format.

### Export

Click **Export CSV** to download your current host list. Useful for backups
or migrating to a new QuietKeep instance.

---

## 7. SSH Key Setup

QuietKeep connects to your hosts over SSH using key-based authentication.
No passwords are stored or transmitted after initial key deployment.

### Option A: Generate in QuietKeep (recommended)

During the wizard, click **Generate Key for Me**. QuietKeep creates an
Ed25519 key pair inside the container. The public key is displayed with
a copy button.

### Option B: Use Your Own Key

If you already have an SSH key pair, go to **Settings > SSH** and paste
the private key contents into the **Load SSH Private Key** field. Click
**Load Key**. QuietKeep derives the public key automatically.

### Why a Dedicated Key?

Using a separate key for QuietKeep (instead of your personal key) means:

- You can revoke QuietKeep's access without affecting your own SSH access
- You can rotate the key independently
- Audit logs clearly show which connections came from QuietKeep

---

## 8. Deploy Keys to Hosts

After generating or loading your SSH key, you need to add the public key
to each managed host's `authorized_keys` file.

### Option A: Deploy from QuietKeep (recommended)

During the wizard or from **Settings > SSH > Deploy SSH Key to Hosts**:

1. Enter the SSH password for each host (or use "Deploy to All" with one password)
2. Click **Deploy**
3. QuietKeep connects via password, adds the public key, and confirms success

After deployment, password authentication is no longer needed. All future
connections use the key.

### Option B: Manual Deployment

Copy the public key from **Settings > SSH** and add it to each host manually:

```bash
# On each managed host:
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### Verify Connectivity

Go to **Settings > Hosts** and click the SSH test button next to each host.
A green check means the key is working. A red X means something needs to
be fixed (check the error message for details).

---

## 9. Sudoers Configuration

QuietKeep needs passwordless sudo for a specific set of commands on each
managed host. Without this, scanning and patching will fail.

### What Commands Need Sudo

| Command | Purpose |
|---------|---------|
| `apt-get update` | Check for available updates (Debian/Ubuntu/Kali) |
| `apt-get upgrade` | Apply updates |
| `apt-get dist-upgrade` | Apply updates including held-back packages (Kali) |
| `apt-get autoremove` | Clean up unused packages |
| `pacman -Sy` | Sync package database (Arch/CachyOS) |
| `pacman -Su` | Apply updates |
| `reboot` | Reboot the host when requested by the user |

### Option A: Auto-Fix from QuietKeep

QuietKeep can probe each host's sudoers configuration and fix it automatically:

1. Go to the Host Detail page for any host
2. Click **Probe Sudoers** to check the current state
3. If the probe shows missing permissions, click **Fix Sudoers**
4. Enter the host's sudo password when prompted
5. QuietKeep creates a sudoers drop-in file with only the required commands

### Option B: Manual Configuration

On each managed host, create a sudoers drop-in file:

```bash
sudo visudo -f /etc/sudoers.d/quietkeep
```

Add this line (replace `YOUR_USER` with the SSH username):

```
YOUR_USER ALL=(ALL) NOPASSWD: /usr/bin/apt-get update, /usr/bin/apt-get upgrade *, /usr/bin/apt-get dist-upgrade *, /usr/bin/apt-get autoremove *, /usr/sbin/reboot
```

For Arch/CachyOS hosts:

```
YOUR_USER ALL=(ALL) NOPASSWD: /usr/bin/pacman -Sy, /usr/bin/pacman -Su --noconfirm, /usr/sbin/reboot
```

---

## 10. Scanning Hosts

Scanning checks each host for available package updates and system status.

### What a Scan Collects

- Available package updates (name, current version, available version)
- Whether a reboot is required (kernel updates)
- OS name and version (from `/etc/os-release`)
- Kernel version (from `uname -r`)
- System uptime and last boot time
- Sudoers status (whether QuietKeep has the permissions it needs)

### How to Scan

- **Scan All:** Click **Scan All** on the Home page to scan every host
- **Scan One:** Click **Scan** on any individual host's detail page

Scans run in the background. A green banner appears while scanning is in
progress. Results appear automatically when complete.

### Automatic Scanning

QuietKeep runs automatic scans on a schedule. Configure the interval in
**Settings > Scan Interval**. The default is every 6 hours. You can also
disable automatic scanning entirely.

---

## 11. Patching Hosts

After scanning, hosts with available updates show a patch count on the
Home page and a **Patch** button on the Host Detail page.

### Applying Patches

1. Navigate to the host's detail page
2. Review the list of available updates
3. Click **Patch**
4. Confirm the action in the dialog

QuietKeep runs the appropriate package manager command (`apt-get upgrade`,
`pacman -Su`, etc.) and captures the full output. After patching completes,
a re-scan runs automatically to verify the results.

### Patch History

Every patch attempt is logged with:
- Timestamp
- Success or failure status
- Number of packages updated
- Full command output (expandable)

View patch history on the Host Detail page under **Patch History**.

### Held-Back Packages

Sometimes the package manager holds back packages that require new
dependencies (commonly kernel metapackages). QuietKeep detects these and
shows an **Install Held Back** button. This runs `apt-get upgrade
--with-new-pkgs` to bring them in. The host may need a reboot afterward.

### Rebooting

If a host needs a reboot (typically after a kernel update), QuietKeep shows
a reboot indicator. Click **Reboot** on the Host Detail page to reboot the
host remotely. The host will be temporarily unavailable during reboot.

---

## 12. Docker Stack Management

QuietKeep discovers and manages Docker Compose stacks on any host where
you checked "Has Docker" when adding it.

### What QuietKeep Detects

- All running Docker Compose stacks (projects)
- Container names, images, and tags
- Whether newer images are available upstream

### Updating Stacks

1. Go to the **Docker Stacks** tab
2. Click on a stack to see its containers
3. If updates are available, click **Update**
4. QuietKeep runs `docker compose pull && docker compose up -d` on the host

### Docker Scan

Docker scans run alongside system scans (both on manual "Scan All" and
on the automatic schedule). You can also trigger a Docker-only scan from
Settings.

### Update History

Docker update attempts are logged the same way as patches: timestamp,
status, and full output.

---

## 13. Diagnostics

The **Diagnostics** tab shows fleet-wide system health at a glance:

| Column | Source |
|--------|--------|
| OS | `/etc/os-release` PRETTY_NAME |
| Kernel | `uname -r` |
| Uptime | System uptime since last boot |
| Reboot Required | Checks for `/var/run/reboot-required` |
| Sudoers | Whether QuietKeep has the permissions it needs |
| Last Scan | Timestamp of the most recent scan |

Click any column header to sort. Click any host row to navigate to
its detail page.

Each host's detail page also has a Diagnostics card with the same
information.

---

## 14. Threat Intelligence

The **Threat Intel** tab provides access to the CISA Known Exploited
Vulnerabilities (KEV) catalog directly in QuietKeep.

### What Is CISA KEV?

The Cybersecurity and Infrastructure Security Agency (CISA) maintains a
curated list of vulnerabilities that are actively being exploited in the
wild. This is not a complete CVE database. It is a list of
vulnerabilities that attackers are using right now.

### Features

- Browse the full KEV catalog with search
- Filter by vendor, product, or time range
- Filter by threat actor (shows which groups exploit which CVEs)
- Filter for ransomware-linked vulnerabilities
- Auto-updated from the official CISA feed

---

## 15. Settings

Access Settings from the gear icon in the top-right corner.

### SSH
- View or change the SSH private key
- View the public key (for manual deployment)
- Deploy keys to hosts

### Hosts
- Add, edit, or delete managed hosts
- Import/export host lists via CSV
- Test SSH connectivity per host

### Scanning
- Set the automatic scan interval (default: 6 hours)
- Enable or disable automatic scanning

### Security
- Change your admin password
- Enable or disable two-factor authentication (TOTP)

### About
- Version information
- License (AGPL-3.0)
- Links to report bugs or request features

---

## 16. Two-Factor Authentication

QuietKeep supports time-based one-time passwords (TOTP) as an optional
second factor for login.

### Enable 2FA

1. Go to **Settings > Security**
2. Click **Enable Two-Factor Authentication**
3. Scan the QR code with your authenticator app (Google Authenticator,
   Authy, 1Password, Bitwarden, etc.)
4. If you cannot scan the QR code, click to reveal the manual text secret
   and type it into your authenticator app
5. Enter the 6-digit code from your authenticator to verify
6. 2FA is now active

### Login with 2FA

After entering your username and password, you will be prompted for the
6-digit TOTP code from your authenticator app.

### Disable 2FA

Go to **Settings > Security** and click **Disable Two-Factor Authentication**.
You will need to confirm with a TOTP code.

---

## 17. Reverse Proxy and SSL

QuietKeep generates a self-signed HTTPS certificate on first startup.
This encrypts all traffic but causes browser warnings because the
certificate is not issued by a trusted authority.

To get a proper SSL certificate and eliminate browser warnings, put
QuietKeep behind a reverse proxy with Let's Encrypt.

### Recommended Reverse Proxies

- **Nginx Proxy Manager** - web UI for managing reverse proxy rules and
  SSL certificates. Good for users who prefer a visual interface.
- **Traefik** - automatic SSL with Docker labels. Good for Docker-heavy
  setups.
- **Caddy** - automatic HTTPS with minimal configuration. Good for
  simple setups.

### General Steps

1. Point a domain or subdomain at your QuietKeep server's IP
2. Set up your reverse proxy to forward HTTPS traffic to
   `https://localhost:443` on the QuietKeep server
3. Configure Let's Encrypt in your reverse proxy for automatic certificate
   renewal
4. Access QuietKeep through your domain instead of the IP address

### Port Configuration

If your reverse proxy runs on the same server as QuietKeep, you may need
to change QuietKeep's ports to avoid conflicts. Edit the `ports` section
in `docker-compose.yml`:

```yaml
ports:
  - "8443:443"
  - "8080:80"
```

Then configure your reverse proxy to forward to `localhost:8443`.

---

## 18. Updating QuietKeep

To update to a newer version:

```bash
cd ~/quietkeep
git pull
docker compose up -d --build
```

This pulls the latest source code and rebuilds the image. Your data,
settings, SSH keys, and certificates are stored in named Docker volumes
and are not affected by rebuilds.

---

## 19. Password Reset

If you forget your admin password, you can reset it from the server
command line. This requires SSH or console access to the QuietKeep server.

```bash
# Generate a reset token
docker exec quietkeep-quietkeep-1 python -c "
import secrets, pathlib
token = secrets.token_urlsafe(32)
pathlib.Path('/app/data/.password_reset_token').write_text(token)
print(f'Reset token: {token}')
"
```

Then open QuietKeep in your browser and click **Forgot Password** on the
login page. Enter the token that was printed to your terminal.

The reset token is a one-time use file stored on the server filesystem.
It cannot be generated or used remotely. This is by design: password
reset requires physical or SSH access to the server.

---

## 20. Troubleshooting

### SSH connection fails with "connection error" (not "Permission denied")

If QuietKeep runs in Docker on a host that is also in its managed hosts
list, SSH from the container to the same host may fail. The container's
source IP is on the Docker bridge network (typically `172.18.0.x`), not
your LAN subnet. If your firewall only allows SSH from your LAN:

```bash
sudo ufw allow from 172.18.0.0/16 to any port 22 proto tcp comment "QuietKeep container self-access"
```

### Scanning hangs or shows "database is locked"

This was a known issue with large fleets (18+ hosts scanning in parallel).
It has been fixed with concurrency limiting. If you see this on an older
version, update QuietKeep.

### Browser shows security warning every time

The self-signed certificate warning should only appear once per browser.
If it keeps appearing, your browser may be clearing exceptions on exit.
Check your browser's certificate exception settings, or set up a reverse
proxy with a real SSL certificate (see [Reverse Proxy and SSL](#17-reverse-proxy-and-ssl)).

### Patching fails with no history entry

Check the host detail page. If the patch ran longer than expected, the
Nginx timeout may have closed the connection before the backend finished.
This has been fixed in newer versions. Update QuietKeep if you experience
this.

### Kali patching fails (0 packages, "failed" status)

This is a known issue being investigated. Scanning works correctly but
patching may fail due to differences in how Kali handles `dist-upgrade`.
Check the patch output log for specific error messages.

### Docker shows false "update available" for QuietKeep's own stack

If you added the QuietKeep server itself as a managed host, the
`quietkeep-quietkeep:latest` image is built locally and has no upstream
registry. The scanner may incorrectly report an update available. This
is cosmetic and does not affect functionality.

### Container won't start after rebuild

Check the Docker logs:

```bash
docker compose logs -f
```

Common causes:
- Port 443 or 80 already in use by another service
- Insufficient disk space for the build
- Network issues pulling base images during build

---

## Getting Help

- **Report a bug:** [GitHub Issue (Bug Report)](https://github.com/quietwire-dev/QuietKeep/issues/new?template=bug_report.md)
- **Request a feature:** [GitHub Issue (Feature Request)](https://github.com/quietwire-dev/QuietKeep/issues/new?template=feature_request.md)
- **In-app help:** Click the gear icon > **Help & FAQ** for searchable answers to common questions

---

*QuietKeep is open source software licensed under [AGPL-3.0](../LICENSE).*
*Copyright (C) 2026 QuietWire (Dennis Ayotte)*
