# Changelog

All notable changes to QuietKeep will be documented in this file.

---

## [1.1.5] - 2026-06-17

### Security
- **JWT signing secret can now be injected via the `QUIETKEEP_JWT_SECRET` environment variable.** When set, it takes precedence and no secret file is written, letting operators keep the secret off disk and source it from an external secret manager. Behaviour is unchanged when unset: a secret is generated and persisted to a `0600` file in the data volume so sessions survive restarts. Hardening prompted by a CodeQL clear-text-storage finding (triaged as accepted risk for the default self-hosted, single-user threat model).

---

## [1.1.4] - 2026-06-17

### Security
- **python-multipart bumped 0.0.30 to 0.0.31**. Fixes a negative Content-Length in `parse_form` that turned the bounded chunked read into a read-until-EOF, buffering the entire request body in memory (CVE-2026-53540, GHSA-v9pg-7xvm-68hf, Low).

---

## [1.1.3] - 2026-06-17

### Security
- **python-multipart bumped 0.0.27 to 0.0.30**. Clears three advisories: quadratic-time querystring parsing with semicolon separators (CPU DoS, CVE-2026-53539), semicolon treated as a querystring field separator enabling parameter smuggling (CVE-2026-53538), and Content-Disposition parameter smuggling via RFC 2231/5987 extended parameters.
- **vite bumped to 8.0.16**. Fixes `server.fs.deny` bypass on Windows alternate paths (CVE-2026-53571) and the bundled launch-editor NTLMv2 hash disclosure via UNC path handling on Windows.
- **js-yaml bumped to 4.2.0** (dev dependency, via eslint). Fixes quadratic-complexity DoS in merge key handling via repeated aliases (CVE-2026-53550).
- **@babel/core bumped to 7.29.7** (dev dependency, via eslint-plugin-react-hooks). Fixes arbitrary file read via sourceMappingURL comment (CVE-2026-49356).
- **brace-expansion bumped** (dev dependency, via @typescript-eslint). Fixes a DoS where a large numeric range defeats the documented `max` protection.

All frontend changes are lockfile-only updates. `npm audit` reports zero vulnerabilities and the production build is unchanged.

---

## [1.1.2] - 2026-05-28

### Fixed
- **Scan interval settings ignored after container restart (BUG-008)**. The scheduler always started at the 6-hour default on restart because `start_scheduler()` read the interval from `config.py` instead of the database. The startup lifespan now reads `scan_interval_hours`, `docker_scan_interval_hours`, and `auto_scan_enabled` from the database before starting the scheduler, so saved settings survive restarts.
- **Patch All messaging and held-back packages (BUG-009)**. The bulk patch results banner now explains the `partial` status in plain text, shows an amber badge per host when packages were held back with a prompt to open the host and install them, and uses a clear message when a network error blocks the request. The `refreshHosts` and `refreshSummary` calls are now ordered so metric tiles reflect the post-scan state.
- **Proxmox kernel updates not triggering reboot required (BUG-010)**. Proxmox VE kernel packages do not reliably write `/var/run/reboot-required`. The reboot check for `proxmox` hosts now falls back to comparing the running kernel (`uname -r`) against the highest installed kernel package. On PVE 8+, packages are named `proxmox-kernel-*-pve-signed`; the `-signed` suffix is stripped before comparison so the version string matches `uname -r` output correctly.
- **Held-back install not logged in activity feed**. Clicking "Install Held-Back Updates" on a host ran the install and created a patch history entry but did not write a record to the Recent Activity feed. The `trigger_install_held_back` endpoint now calls `log_activity` after the install completes.

### Added
- **Version badge on Home page**. The app version is now shown in small text next to the "Overview" heading so the running version is visible without opening Settings.

---

## [1.1.1] - 2026-05-10

### Fixed
- **Host edit/create returns 500 (BUG-007)**. Editing or adding a host returned "API error: 500" because the `tags` relationship was not eagerly loaded after commit. SQLAlchemy async mode does not allow lazy loading, causing a `MissingGreenlet` error during response serialization. Both `update_host` and `create_host` endpoints now re-fetch the host with `selectinload(HostModel.tags)` after commit.

---

## [1.1.0] - 2026-05-10

### Added
- **Host tags/groups**. Organize hosts by role, location, or environment with colored tags. Many-to-many relationship via junction table. Full CRUD API and management UI in Settings with 10 preset colors. Tags display as colored dots on host rows (Home and Dashboard), filter by tag on Dashboard, assign/remove tags per host from Host Detail. Tags card on Home sidebar links directly to filtered Dashboard view.
- **Bulk patch all hosts**. One-click Patch All button on Dashboard patches every host with pending updates. Per-host results banner surfaces errors individually. Automatic re-scan after completion. Confirmation dialog prevents accidental triggers.
- **Recent activity feed**. Home page timeline of scans, patches, reboots, and Docker updates. Color-coded icons by event type. Relative timestamps ("2 min ago") with absolute on hover. Auto-refreshes after scan/patch operations.
- **Patch history export**. Fleet-wide Excel export (.xlsx with one sheet per host, one row per package) and per-host CSV download. Export button on Dashboard header.
- **Disk usage monitoring**. Color-coded disk usage column in Diagnostics table (green < 70%, amber 70-90%, red > 90%). Collected during each host scan via `df -h /`.
- **Build tag badge**. Optional TEST/BETA/PROD label in the nav bar via BUILD_TAG environment variable. Useful for distinguishing test and production instances.
- **Clickable metric tiles**. Home page cards (Hosts, Packages, Docker, Attention) navigate to the relevant page with appropriate pre-filter applied.
- **UI polish**. Host count badges on OS and tag filter tabs. Active filter indicator bar with dismissible chips and match count on Dashboard. Relative timestamps via new `timeAgo()` utility.
- **User Guide link**. Accessible from Settings > About and Help & FAQ page, linking to the full User Guide on GitHub.

### Fixed
- `fetchJson` now handles HTTP 204 No Content responses (tag assign/remove endpoints returned empty body, causing silent JSON parse failures)

---

## [1.0.3] - 2026-05-09

### Fixed
- **Docker stack update reporting false success (BUG-006)**. The SSH client's `run_command` returned `success=True` whenever the SSH session completed, ignoring the remote command's exit status. This caused failed Docker stack updates (e.g. "no space left on device") to be recorded as successful in the update history. The success flag now reflects the remote command's exit code, so failures are correctly reported with a red badge in the UI.

---

## [1.0.2] - 2026-05-08

### Security
- Bumped `python-multipart` from 0.0.26 to 0.0.27 (CVE-2026-40347, denial of service via crafted multipart/form-data requests)

---

## [1.0.1] - 2026-05-06

### Fixed
- **First-Run Wizard reappearing on every login (BUG-005)**. The wizard dismissal state was stored only in React component state, which reset on every page load. Now a `wizard_completed` flag is persisted in the app_settings database table. Completing or skipping the wizard sets the flag server-side so it survives browser restarts and cookie clears.

### Security
- Sanitized error messages in API responses to prevent information exposure (CWE-209)
- Restricted file permissions on server-side secrets

---

## [1.0.0] - 2026-05-05

### Added
- **Diagnostics tab**. New fleet-wide Diagnostics page showing all hosts in a sortable table with OS, kernel version, uptime, reboot status, sudoers status, and last scan time. Columns are sortable by clicking headers. Includes a Scan All button for quick fleet-wide refresh
- **Per-host Diagnostics card**. The Host Detail page now includes a Diagnostics section consolidating OS name, kernel version, uptime, reboot status, sudoers status, and last scan in a compact grid
- **Real OS name detection**. Each scan now reads `PRETTY_NAME` from `/etc/os-release` via SSH, showing the actual distribution name and version (e.g. "Ubuntu 24.04.1 LTS", "Debian GNU/Linux 13 (trixie)", "CachyOS") instead of the generic package manager label
- **Kernel version probing**. Each scan now runs `uname -r` via SSH and displays the running kernel version per host (e.g. "6.8.0-111-generic", "6.17.13-2-pve"). Useful for tracking kernel-specific CVEs across the fleet
- **Host uptime display**. Every host row on Home shows how long it has been online (e.g. `up 3d 4h`), and the Host Detail page shows the same alongside the last-scan timestamp. Useful for spotting hosts that have gone too long between reboots or been stuck pending for a while
- **Held-back updates surfacing**. When `apt-get upgrade` defers packages that would require installing new dependencies (typically kernel metapackages on Ubuntu/Debian), the Host Detail page now shows a dedicated card listing what was held back, with an explicit Install Held-Back Updates button that runs `apt-get upgrade --with-new-pkgs`. A Held Back column on the Host Management table shows the count per host so you can spot deferred updates at a glance
- **Faster Docker stack scans**. Docker discovery and update checks across multiple hosts now run in parallel instead of sequentially
- **Automated sudoers probing**. Every host scan now checks whether the `/etc/sudoers.d/quietkeep-<user>` NOPASSWD rule is present. Status is surfaced as an OK / Needs Fix / Unknown / Root badge in both Host Detail and Host Management
- **One-click Fix Sudoers**. New modal installs the sudoers rule on a host using a one-time password, eliminating the need to SSH into each host by hand
- **GPG key-rotation detection**. The patcher recognizes NO_PUBKEY / EXPKEYSIG / expired-key failures on apt and Kali hosts and tags the patch log so the UI can respond
- **Keyring recovery modal**. When a key rotation is detected, the Host Detail view shows a persistent banner and an in-app popup with OS-specific secure recovery commands (HTTPS-fetched archive keyring, sha256 verification, dpkg install). No auto-trust of new signing keys by design
- **`apt-get --fix-broken install` step**. The patcher now completes half-finished dpkg transactions before running the upgrade, fixing a common source of silent patch stalls on Kali rolling releases
- **Shared ConfirmDialog component**. Centered, accessible confirmation modal with danger/warning/primary variants. Replaces native `window.confirm()` dialogs across Patch, Reboot, Docker Update, and Delete All Hosts
- **Home overview page**. Default landing page with at-a-glance host and Docker status
- **Docker stack management**. Discover, scan, and update Docker Compose stacks across hosts
- **One-click Docker updates**. Pull latest images and recreate containers with full log capture
- **Release notes links**. Auto-generated links to GitHub releases for container images
- **Pre-flight system checks**. First-run wizard verifies Python, SSH keys, OS, and Docker
- **System requirements FAQ**. Server specs, supported OS types, and Docker versioning in Help tab
- **Bug reporting**. Report a Bug link in Help tab for easy issue submission
- **Threat Intel dashboard**. CISA Known Exploited Vulnerabilities (KEV) catalog with vendor, threat actor, and time range filtering. Includes ransomware-linked CVE tracking
- **Light/Dark/System themes**. Full theme support with persistent preference
- **Settings page**. SSH config, scan intervals, auto-scan toggle, host management
- **First-run wizard**. Guided setup for new installations
- **Authentication**. Single-user admin login with username/password, JWT session cookies, and HTTP-only secure tokens
- **Two-factor authentication**. Optional TOTP 2FA via authenticator app (Google Authenticator, Authy, 1Password, Bitwarden). QR code enrollment with manual text secret fallback
- **Password reset**. Filesystem-based reset token for recovery without email or cloud dependencies
- **SSH key generation**. One-click Ed25519 key generation in the first-run wizard with copy button
- **Deploy Keys wizard step**. Deploy SSH keys to all hosts with a single password entry during first-run setup
- **Scanning-in-progress banner**. Dashboard shows a green banner with spinner while scans are running
- **Feature request links**. Report Bug and Request Feature links in the gear dropdown and Help page, linking to GitHub issue templates
- **SSH key upload via web UI**. Paste your private key, public key is derived automatically
- **Deploy SSH Key to Hosts**. Push the public key to managed hosts with one click using password auth
- **Host setup script**. Downloadable script to automate SSH key and sudo configuration
- **Docker Compose deployment**. Single compose file, builds from source, no manual config needed
- **Auto-detect server IP**. Self-signed cert generated with correct SAN at startup, no env vars required
- **Multi-OS support**. Debian/Ubuntu (apt), Kali Linux, Arch/CachyOS (pacman), Proxmox VE
- **Patch management**. Scan, patch, track history, detect reboots
- **Dashboard**. Clickable filter cards, progress banners, expandable log viewer
- **30-day auto-cleanup**. Patch history older than 30 days is automatically removed
- **Version display**. Settings > About shows the current QuietKeep version read from the VERSION file

### Fixed
- Reboot action now reports honest success/failure based on SSH session behavior and sudo exit codes instead of always returning success
- Patch runs that fail because the host is missing a NOPASSWD sudoers rule no longer misreport as success with 0 packages; they now fail loudly and the UI surfaces the sudoers badge
- `setup-host.sh` sudoers rule widened to cover `apt-get` and `pacman` commands (previously only `apt`), fixing silent patch failures on hosts that were set up with the earlier, narrower rule
- Confirmation dialogs for Patch, Reboot, Docker Update, and Delete All Hosts now render in the center of the viewport instead of at the top where they were easy to miss (BUG-003)
- SSH Test indicator in Host Management now reflects the persisted online state after the test completes instead of showing stale data
- Docker scanner now preserves stack IDs across scans (upsert instead of delete/recreate)
- Docker update history persists correctly after re-scans
- Release notes links resolve correctly for monorepo images (Immich, Home Assistant, etc.)
- SSH clipboard copy works on non-HTTPS connections (fallback method)
- Light mode badge contrast improved for update indicators
- SSH key path mismatch between Dockerfile ENV and upload destination
- HomePage not refreshing host data after Scan All completes
- Scanner concurrency no longer overwhelms SQLite with large fleets (18+ hosts). Added semaphore limiting to 3 concurrent scans for both system and Docker scanners
- Auto-scan after first-run wizard now triggers both system and Docker scans
- Auto-scan promise no longer lost on wizard component unmount
- Docker update detection no longer flags locally-built images (no registry) as having updates available
- SSL warning in first-run wizard restyled from subtle blue to prominent amber with Shield icon
- Delete All Hosts modal now explicitly lists all data that will be removed (scan history, patch audit history, Docker stack data, Docker update logs)
- Removed all em dashes from source code and documentation

### Security
- Bumped `python-jose` from 3.3.0 to 3.4.0 (CVE-2024-33663, CRITICAL: algorithm confusion with ECDSA keys)
- Bumped `python-multipart` from 0.0.24 to 0.0.26 (CVE-2026-40347, MEDIUM)
- Bumped `postcss` from 8.5.9 to 8.5.10 (CVE-2026-41305, MEDIUM)
- All API routes (except health and auth) require valid JWT session
- Passwords hashed with bcrypt via passlib
- JWT secret auto-generated on first run, stored on persistent volume
- Removed .semgrepignore exception file (false positive no longer exists)
