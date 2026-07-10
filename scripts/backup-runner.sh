#!/bin/sh
# scripts/backup-runner.sh — Day 18 (IMPLEMENTATION-PLAN Step 18.3)
#
# Three-layer Postgres backup loop, run inside the `backup` compose service
# (postgres:15-alpine + aws-cli):
#   Layer 1: WAL segments  -> s3://$S3_BUCKET/backups/wal/     (every 60s)
#   Layer 2: pg_dump -Fc   -> s3://$S3_BUCKET/backups/daily/   (daily 03:00-03:59 UTC)
#   Layer 3: pg_basebackup -> s3://$S3_BUCKET/backups/weekly/  (Sunday 03:00-03:59 UTC)
# Retention: WAL 7 days, dailies 30 days, weeklies 4 weeks (enforced after each upload window).
#
# Design notes (plan Step 18.3): single script = single point to debug; no cron daemon in
# Alpine; if this container dies, WAL files simply accumulate on the shared volume and
# Postgres is unaffected. CRITICAL alert when the WAL backlog exceeds 100 files.

set -u

log()  { echo "[backup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
crit() { echo "[backup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') CRITICAL: $*" >&2; }

validate_env() {
  missing=""
  for var in PGPASSWORD POSTGRES_USER POSTGRES_DB S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
    eval "val=\${$var:-}"
    [ -n "$val" ] || missing="$missing $var"
  done

  if [ -n "$missing" ]; then
    crit "missing required env vars:$missing — backups DISABLED"
    exit 1
  fi

  # aws-cli reads these names:
  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}"

  # Recent aws-cli adds data-integrity checksums by default (when_supported); Huawei OBS
  # rejects them with `XAmzContentSHA256Mismatch` on PutObject/UploadPart, so uploads (WAL,
  # dumps, basebackups) fail while ls/get succeed. Only send checksums when required.
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
  export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

  # Huawei OBS only accepts virtual-hosted-style addressing
  # (bucket.obs.<region>.myhuaweicloud.com). With --endpoint-url the aws-cli otherwise
  # defaults to path-style and OBS rejects it with `VirtualHostDomainRequired`. Mirrors
  # storage.ts `forcePathStyle: false`.
  aws configure set default.s3.addressing_style virtual

  # The shared wal_archive volume is created root-owned, but Postgres runs archive_command
  # as the `postgres` user and must WRITE completed WAL segments here. This backup container
  # runs as root and shares the volume (same postgres:15-alpine image, matching uid), so fix
  # ownership on startup (idempotent). Without this, archive_command fails permission-denied
  # and WAL archiving never runs (archived_count stays 0, failed_count climbs).
  chown postgres:postgres /wal_archive 2>/dev/null || true
}

s3() { aws s3 "$@" --endpoint-url "$S3_ENDPOINT"; }

health_check() {
  if ! psql -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT 1' >/dev/null 2>&1; then
    crit "cannot reach Postgres (psql SELECT 1 failed) — check PGPASSWORD/network"
    return 1
  fi

  if ! s3 ls "s3://$S3_BUCKET/" >/dev/null 2>&1; then
    crit "cannot reach OBS bucket $S3_BUCKET — check S3_* credentials/endpoint"
    return 1
  fi

  log "health check passed (Postgres + OBS reachable)"
  return 0
}

# Delete objects under a prefix older than N days (aws s3 ls date is column 1, YYYY-MM-DD).
prune_prefix() {
  prefix="$1"
  days="$2"
  cutoff=$(date -u -d "-${days} days" '+%Y-%m-%d' 2>/dev/null || date -u -v "-${days}d" '+%Y-%m-%d')

  s3 ls "s3://$S3_BUCKET/$prefix" 2>/dev/null | while read -r d _t _size key; do
    [ -n "$key" ] || continue

    if [ "$d" \< "$cutoff" ]; then
      log "retention: deleting $prefix$key (dated $d, older than ${days}d)"
      s3 rm "s3://$S3_BUCKET/$prefix$key" >/dev/null 2>&1
    fi
  done
}

validate_env

until health_check; do
  log "retrying health check in 60s"
  sleep 60
done

LAST_DUMP_DAY=""
LAST_BASE_WEEK=""
LAST_PRUNE_DAY=""

log "entering backup loop"

while true; do
  HOUR=$(date -u +%H)
  DOW=$(date -u +%u)   # 1=Mon .. 7=Sun
  TODAY=$(date -u +%Y%m%d)
  WEEK=$(date -u +%Y%V)

  # Layer 1 — WAL upload (every loop). Uploaded segments are removed from the shared volume.
  for f in /wal_archive/*; do
    [ -f "$f" ] || continue

    if s3 cp "$f" "s3://$S3_BUCKET/backups/wal/$(basename "$f")" >/dev/null 2>&1; then
      rm -f "$f"
    else
      crit "WAL upload failed for $(basename "$f") — leaving on volume for retry"
      break # OBS likely down; don't hammer it for every segment
    fi
  done

  # Layer 2 — daily pg_dump at 03:00-03:59 UTC (once per day).
  if [ "$HOUR" = "03" ] && [ "$LAST_DUMP_DAY" != "$TODAY" ]; then
    DUMP_FILE="/tmp/prompify-$(date -u +%Y%m%d_%H%M%S).dump"
    log "starting daily pg_dump -> $DUMP_FILE"

    if pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl -f "$DUMP_FILE" 2>&1; then
      if s3 cp "$DUMP_FILE" "s3://$S3_BUCKET/backups/daily/" >/dev/null 2>&1; then
        log "daily dump uploaded: $(basename "$DUMP_FILE") ($(du -h "$DUMP_FILE" | cut -f1))"
        LAST_DUMP_DAY="$TODAY"
      else
        crit "daily dump upload to OBS failed — will retry next loop"
      fi
    else
      crit "pg_dump FAILED — daily backup missing for $TODAY"
    fi

    rm -f "$DUMP_FILE"
  fi

  # Layer 3 — weekly pg_basebackup, Sunday 03:00-03:59 UTC (once per ISO week).
  if [ "$DOW" = "7" ] && [ "$HOUR" = "03" ] && [ "$LAST_BASE_WEEK" != "$WEEK" ]; then
    BASE_DIR="/tmp/base-$WEEK"
    log "starting weekly pg_basebackup -> $BASE_DIR"

    if pg_basebackup -h postgres -U "$POSTGRES_USER" -D "$BASE_DIR" -Ft -z --no-password 2>&1; then
      TARBALL="/tmp/base-$WEEK.tar.gz"
      tar -czf "$TARBALL" -C "$BASE_DIR" . 2>/dev/null || TARBALL="$BASE_DIR/base.tar.gz"

      if s3 cp "$TARBALL" "s3://$S3_BUCKET/backups/weekly/base-$WEEK.tar.gz" >/dev/null 2>&1; then
        log "weekly basebackup uploaded: base-$WEEK.tar.gz"
        LAST_BASE_WEEK="$WEEK"
      else
        crit "weekly basebackup upload failed — will retry next loop"
      fi
    else
      crit "pg_basebackup FAILED for week $WEEK"
    fi

    rm -rf "$BASE_DIR" "/tmp/base-$WEEK.tar.gz"
  fi

  # Retention — once per day, after the 03:00 window.
  if [ "$HOUR" = "04" ] && [ "$LAST_PRUNE_DAY" != "$TODAY" ]; then
    log "enforcing retention (WAL 7d, daily 30d, weekly 28d)"
    prune_prefix "backups/wal/" 7
    prune_prefix "backups/daily/" 30
    prune_prefix "backups/weekly/" 28
    LAST_PRUNE_DAY="$TODAY"
  fi

  # Alert if the WAL backlog grows (OBS down / creds broken) — volume-fill early warning.
  WAL_COUNT=$(ls /wal_archive/ 2>/dev/null | wc -l)

  if [ "$WAL_COUNT" -gt 100 ]; then
    crit "WAL backlog = $WAL_COUNT files — check OBS connectivity before the volume fills"
  fi

  sleep 60
done
