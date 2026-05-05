#!/bin/bash
# QuietKeep: entrypoint.sh
# Docker container entrypoint. Generates a self-signed TLS cert on first run,
# starts Nginx (reverse proxy), then launches Uvicorn as the foreground process
# so Docker can track it as PID 1. Cert uses SAN for both IP and DNS access.
# Author: QuietWire (Dennis Ayotte)
set -e

# QUIETKEEP_HOST can be set in docker-compose.yml; auto-detects if omitted.
HOST="${QUIETKEEP_HOST:-}"

if [ -z "${HOST}" ] || [ "${HOST}" = "localhost" ] || [ "${HOST}" = "YOUR_SERVER_IP" ]; then
    HOST=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "${HOST}" ]; then
        HOST="localhost"
    fi
    echo "[QuietKeep] Auto-detected host IP: ${HOST}"
fi

# Generate self-signed certificate on first run
if [ ! -f /app/certs/cert.pem ] || [ ! -f /app/certs/key.pem ]; then
    echo "[QuietKeep] Generating self-signed certificate for: ${HOST}"

    # Detect if HOST is an IP address or a hostname
    if echo "${HOST}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        SAN="IP:${HOST},IP:127.0.0.1,DNS:localhost"
    else
        SAN="DNS:${HOST},DNS:localhost,IP:127.0.0.1"
    fi

    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /app/certs/key.pem \
        -out /app/certs/cert.pem \
        -subj "/CN=${HOST}" \
        -addext "subjectAltName=${SAN}" \
        2>/dev/null

    echo "[QuietKeep] Certificate generated. Valid for 10 years."
else
    echo "[QuietKeep] Using existing certificate."
fi

# Start Nginx
echo "[QuietKeep] Starting Nginx..."
nginx

# Start backend (foreground, Docker tracks this process).
# exec replaces the shell so Uvicorn becomes PID 1 and receives SIGTERM on stop.
# Listens on 127.0.0.1 only because Nginx handles external traffic.
echo "[QuietKeep] Starting backend..."
exec uvicorn app.main:app --host 127.0.0.1 --port 8000
