# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: Build the frontend (vite outputs to /app/static/dist).
# ---------------------------------------------------------------------------
FROM node:22-slim AS frontend-builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci --ignore-scripts
COPY frontend/ frontend/
RUN cd frontend && npm run build

# ---------------------------------------------------------------------------
# Stage 2: Runtime image — no compilers, no Node, no npm.
#
# Python dependencies are installed from prebuilt wheels (argon2-cffi/cffi ship
# manylinux wheels for amd64 and arm64, the only targets we build), so no C
# toolchain is needed. They are pinned by uv.lock and installed into the system
# site-packages so the layout matches what the backup cron job's plain `python`
# interpreter expects. uv itself runs only during the build and is removed in
# the same layer, so it never reaches the final image.
# ---------------------------------------------------------------------------
FROM python:3.13-slim

# Prevent Python from writing .pyc files and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install gosu for privilege dropping and cron for backup scheduling
RUN apt-get update && apt-get install -y --no-install-recommends gosu cron \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser

# Install the locked Python dependencies. pyproject.toml/uv.lock are copied
# before the application code so this layer stays cached across code changes.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-emit-project -o /tmp/requirements.txt \
    && uv pip install --system --no-cache -r /tmp/requirements.txt \
    && rm /bin/uv /tmp/requirements.txt

# Bring in the built frontend assets
COPY --from=frontend-builder /app/static/dist static/dist

# Copy application code
COPY backend/ backend/

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R appuser:appuser /app

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Declare volume for data persistence
VOLUME /app/data

ENTRYPOINT ["/entrypoint.sh"]

# Expose the application port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')" || exit 1

# Run the application. Shell form is intentional so ${TICKR_TRUSTED_PROXIES}
# expands at container start — uvicorn only honors X-Forwarded-For from the
# configured peer IP(s), so misconfiguring this fails *closed* (all clients
# look like the proxy) rather than trusting forged headers from anywhere.
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port 8000 --no-access-log --proxy-headers --forwarded-allow-ips=${TICKR_TRUSTED_PROXIES:-127.0.0.1}"]
