# Contributing to QuietKeep

Thanks for your interest in contributing to QuietKeep! This document covers
how to get started, what we expect from contributions, and how to submit
changes.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a feature branch from `main`

## Development Setup

QuietKeep runs as a single Docker container. For local development:

```bash
# Clone the repo
git clone https://github.com/quietwire-dev/QuietKeep.git
cd QuietKeep

# Build and run with Docker Compose
docker compose up -d --build

# Access the UI
open https://localhost
```

### Project Structure

```
backend/          Python (FastAPI) backend
  app/
    routers/      API endpoints
    services/     Scanner, patcher, Docker scanner
    ssh/          SSH client wrapper
    models.py     SQLAlchemy models
    database.py   Async SQLite engine
frontend/         React + TypeScript frontend
  src/
    components/   UI components
    hooks/        API and auth hooks
deploy/           Docker and deployment files
```

### Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy (async), asyncssh, aiosqlite
- **Frontend:** React 18, TypeScript, Tailwind CSS, Lucide icons
- **Database:** SQLite with WAL mode
- **Auth:** JWT (HTTP-only cookies) + optional TOTP 2FA

## What We Accept

- Bug fixes with clear description of the problem
- Performance improvements with benchmarks
- New host OS support (package manager parsers)
- Documentation improvements
- UI/UX improvements

## What We Probably Won't Accept

- Features that require external services or accounts
- Changes that collect user data or phone home
- Breaking changes to the single-container deployment model

## Submitting Changes

1. Create a branch: `git checkout -b fix/short-description`
2. Make your changes, keeping commits focused
3. Test locally with a fresh Docker build
4. Push to your fork and open a Pull Request
5. Describe what changed and why in the PR description

## Code Style

- **Python:** Follow existing patterns. Type hints encouraged. No `print()` statements (use `logging`).
- **TypeScript:** Follow existing patterns. No `any` types without justification.
- **Comments:** Explain *why*, not *what*. No comments on self-explanatory code.
- **Commits:** Short, descriptive messages. Prefix with `fix:`, `feat:`, `docs:`, `perf:`, etc.

## Reporting Bugs

Use the [Bug Report](https://github.com/quietwire-dev/QuietKeep/issues/new?template=bug_report.md) template.

## Requesting Features

Use the [Feature Request](https://github.com/quietwire-dev/QuietKeep/issues/new?template=feature_request.md) template.

## Security Issues

Do **not** open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the
[AGPL-3.0 License](LICENSE).
