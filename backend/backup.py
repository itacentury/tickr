"""Standalone SQLite backup script for the Tickr database.

Creates atomic hot backups using sqlite3's online backup API and enforces
a configurable retention policy. Designed to be invoked via cron:

    docker exec tickr python -m backend.backup

Configuration via environment variables:
    TICKR_BACKUP_DIR   — backup output directory (default: data/backups)
    TICKR_BACKUP_RETAIN — number of backups to keep (default: 7)
"""

import logging
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from backend.database import DATABASE

logger = logging.getLogger(__name__)


def create_backup(db_path: str, backup_dir: str = "data/backups", retain: int = 7) -> Path:
    """Create an atomic hot backup of the SQLite database.

    Uses sqlite3's online backup API so the source database can remain
    open and written to during the backup.

    Args:
        db_path: Path to the source SQLite database.
        backup_dir: Directory to store backup files.
        retain: Number of backup files to keep (oldest are deleted).

    Returns:
        Path to the newly created backup file.
    """
    backup_path = Path(backup_dir)
    backup_path.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    dest_file = backup_path / f"tickr_{timestamp}.db"

    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(str(dest_file))
    try:
        src.backup(dst)
        logger.info("Backup created: %s", dest_file)
    finally:
        dst.close()
        src.close()

    _enforce_retention(backup_path, retain)
    return dest_file


def _enforce_retention(backup_dir: Path, retain: int) -> None:
    """Delete oldest backup files beyond the retention count.

    Args:
        backup_dir: Directory containing backup files.
        retain: Maximum number of backup files to keep.
    """
    backups = sorted(backup_dir.glob("tickr_*.db"))
    excess = backups[: len(backups) - retain]
    for old in excess:
        old.unlink()
        logger.info("Deleted old backup: %s", old)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    backup_dir = os.getenv("TICKR_BACKUP_DIR", "data/backups")
    retain = int(os.getenv("TICKR_BACKUP_RETAIN", "7"))

    try:
        create_backup(DATABASE, backup_dir, retain)
    except Exception:
        logger.exception("Backup failed")
        sys.exit(1)
