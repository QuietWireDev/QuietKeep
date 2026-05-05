# Security

## Security Posture

QuietKeep is a self-hosted application. All data stays on your server. There are no cloud dependencies, telemetry, or external accounts required.

**Authentication:**
- Single-user admin login with username and password
- Passwords hashed with bcrypt (via passlib, pinned to bcrypt 4.0.1)
- JWT session tokens in HTTP-only, Secure, SameSite=Strict cookies
- JWT secret auto-generated on first run, stored on a persistent Docker volume
- Optional TOTP two-factor authentication via any standard authenticator app
- Password reset requires filesystem access to the server (no email, no cloud)
- All API routes protected except `/api/health` and `/api/auth/*`

**Transport:**
- HTTPS with auto-generated self-signed certificate on first run
- SSH key-based authentication to managed hosts (no passwords stored after key deployment)
- No outbound connections except SSH to managed hosts and HTTPS to CISA KEV feed

## Security Scans

QuietKeep is scanned before every release using five independent tools. No exceptions or suppressions are configured.

**[MDN HTTP Observatory](https://developer.mozilla.org/en-US/observatory/)** tests HTTP headers and TLS configuration against current web security standards.

**[Trivy](https://trivy.dev/)** scans dependency files for known vulnerabilities (CVEs) in third-party packages.

**[Semgrep](https://semgrep.dev/)** runs static analysis on source code to catch security bugs and anti-patterns.

**[ScanCode Toolkit](https://github.com/aboutcode-org/scancode-toolkit)** scans every file for license declarations, copyright notices, and embedded package metadata.

**[ScanOSS](https://www.scanoss.com/)** checks source code fingerprints against a database of known open source projects to verify code originality.

| Tool | Target | Result | Date |
|------|--------|--------|------|
| MDN HTTP Observatory | quietwire.dev | A+ (115/100), 10/10 tests passed | 2026-04-11 |
| Trivy 0.69.3 | backend/requirements.txt (pip) | 0 vulnerabilities (HIGH/CRITICAL) | 2026-05-05 |
| Trivy 0.69.3 | frontend/package-lock.json (npm) | 0 vulnerabilities (HIGH/CRITICAL) | 2026-05-05 |
| Semgrep 1.161.0 | 88 source files (518 rules) | 0 findings in source | 2026-05-05 |
| ScanCode 32.5.0 | 134 project files | AGPL-3.0 consistent, all deps AGPL-compatible | 2026-05-05 |
| ScanOSS 1.52.1 | 51 source files | 45 original, 6 boilerplate/scaffold matches (no concerns) | 2026-05-05 |

*All tools at latest versions as of scan date. No .semgrepignore or .trivyignore files. Dates in UTC.*

## Reporting a Vulnerability

If you find a security issue, please report it privately. Do not open a public GitHub issue.

Email: **github@quietwire.dev**

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected version (check Settings > About)

You will receive a response within 72 hours.
