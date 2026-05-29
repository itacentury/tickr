#!/bin/sh
set -e

# Fix ownership of data directory (needed for mounted volumes)
chown -R appuser:appuser /app/data

# Ensure backup target directory exists and is writable by appuser.
# The backup cron job runs as appuser and writes both the backup file
# and the rotating cron.log here.
mkdir -p /app/data/backups
chown appuser:appuser /app/data/backups

# Generate the backup cron job file. Cron does not inherit the container's
# environment, so TICKR_* variables are propagated explicitly: otherwise a
# deploy that overrides e.g. TICKR_DATABASE would have the main app writing
# to one path and the cron job reading the unset default.
CRON_FILE=/etc/cron.d/tickr-backup
{
    printenv | grep '^TICKR_' || true
    echo "0 2 * * * appuser cd /app && python -m backend.backup >> /app/data/backups/cron.log 2>&1"
} > "$CRON_FILE"
chmod 0644 "$CRON_FILE"

# Start the cron daemon (double-forks into the background by default).
cron

# Drop privileges and run the command as appuser
exec gosu appuser "$@"
