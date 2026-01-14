#!/bin/sh
set -e

# Fix ownership of data directory (needed for mounted volumes)
chown -R appuser:appuser /app/data

# Drop privileges and run the command as appuser
exec su-exec appuser "$@"
