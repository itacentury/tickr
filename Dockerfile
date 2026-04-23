# syntax=docker/dockerfile:1

FROM python:3.13-slim

# Prevent Python from writing .pyc files and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install gosu, Node.js for frontend build, and cron for backup scheduling
RUN apt-get update && apt-get install -y --no-install-recommends gosu nodejs npm cron \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser

# Install dependencies first (better layer caching)
COPY pyproject.toml .
RUN python -c "import tomllib; \
    deps = tomllib.load(open('pyproject.toml', 'rb'))['project']['dependencies']; \
    print('\n'.join(deps))" | pip install --no-cache-dir -r /dev/stdin

# Build frontend
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci --ignore-scripts
COPY frontend/ frontend/
RUN cd frontend && npm run build

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
