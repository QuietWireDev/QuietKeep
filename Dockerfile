# Stage 1: Build the React frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --prefer-offline
COPY frontend/ ./
RUN npm run build

# Stage 2: Final image - Python backend + Nginx
FROM python:3.12-slim

# Install Nginx, OpenSSL, and curl (for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    openssl \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r quietkeep && useradd -r -g quietkeep -s /sbin/nologin quietkeep

WORKDIR /app

# Install Python dependencies (no venv needed inside a container)
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application
COPY backend/app ./app
COPY backend/templates ./templates
COPY VERSION ./VERSION

# Copy built frontend from builder stage
COPY --from=frontend-builder /build/dist ./frontend/dist

# Configure Nginx (main config + site config)
COPY deploy/docker/nginx-main.conf /etc/nginx/nginx.conf
COPY deploy/docker/nginx.conf /etc/nginx/sites-available/quietkeep
RUN ln -sf /etc/nginx/sites-available/quietkeep /etc/nginx/sites-enabled/quietkeep \
    && rm -f /etc/nginx/sites-enabled/default

# Copy and configure entrypoint
COPY deploy/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set ownership so non-root user can write to required paths
RUN mkdir -p /app/data /app/certs /app/ssh \
    && chown -R quietkeep:quietkeep /app /var/log/nginx

# Default environment variables (all overridable via docker-compose.yml)
ENV DATABASE_URL=sqlite+aiosqlite:////app/data/quietkeep.db
ENV SSH_KEY_PATH=/app/ssh/id_ed25519_quietkeep
ENV QUIETKEEP_HOST=localhost
ENV QUIETKEEP_DATA_DIR=/app/data

EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -sf -k https://localhost:8443/api/health || exit 1

USER quietkeep
ENTRYPOINT ["/entrypoint.sh"]
