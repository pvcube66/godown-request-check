#!/bin/bash
# Nightly database backup. Keeps the last 14 days. Run from cron on the server:  0 2 * * *  /path/to/scripts/backup.sh
# Needs MONGODB_URI and MONGODB_DB in the environment (or in the repo's .env) and the `mongodump` tool installed.
# Where BACKUP_DIR lives (and copying it off the machine) is decided with the hosting details.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${MONGODB_URI:?MONGODB_URI is not set}"; : "${MONGODB_DB:?MONGODB_DB is not set}"
DIR="${BACKUP_DIR:-./backups}"; mkdir -p "$DIR"
FILE="$DIR/${MONGODB_DB}-$(date +%Y-%m-%d).archive.gz"
mongodump --uri="$MONGODB_URI" --db="$MONGODB_DB" --archive="$FILE" --gzip --quiet
find "$DIR" -name "${MONGODB_DB}-*.archive.gz" -mtime +14 -delete
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"
# Restore (into an empty database, after checking the name!):  mongorestore --uri="$MONGODB_URI" --archive=FILE --gzip --nsFrom='DB.*' --nsTo='NEWDB.*'
