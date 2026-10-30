#!/usr/bin/env bash
# Keep-warm, health checks, and backup.
#
# Cron usage:
#   */10 * * * *  /opt/bgb-rag/deploy/maintenance.sh            (keep-warm + ping)
#   15 3 * * *    /opt/bgb-rag/deploy/maintenance.sh --nightly  (disk + containers)
#   0  4 * * 0    /opt/bgb-rag/deploy/maintenance.sh --snapshot (Langfuse Postgres)
#
# The dead-man's switch (healthchecks.io) is pinged on every successful run;
# a dead cron or a dead VM means no ping and the monitor emails the author.

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:8000}"
DEAD_MANS_SWITCH_URL="${DEAD_MANS_SWITCH_URL:-}"
DISK_WARN_PERCENT="${DISK_WARN_PERCENT:-85}"
COMPOSE_FILE="$(cd "$(dirname "$0")" && pwd)/docker-compose.prod.yml"

ping_switch() {
  if [ -n "$DEAD_MANS_SWITCH_URL" ]; then
    curl -fsS -m 10 "$DEAD_MANS_SWITCH_URL" >/dev/null || echo "WARN: dead-man's switch ping failed" >&2
  fi
}

keep_warm() {
  # Ping /health on a keep-warm schedule (also mitigates Oracle idle reclamation).
  if curl -fsS -m 10 "$APP_URL/health" >/dev/null; then
    echo "OK: app healthy"
  else
    echo "WARN: /health failed" >&2
  fi
  ping_switch
}

nightly_checks() {
  # Disk usage
  usage=$(df / | awk 'NR==2 {gsub("%","",$5); print $5}')
  if [ "$usage" -ge "$DISK_WARN_PERCENT" ]; then
    echo "WARN: disk usage at ${usage}% (threshold ${DISK_WARN_PERCENT}%)" >&2
  else
    echo "OK: disk usage ${usage}%"
  fi
  # Container health
  unhealthy=$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Name}} {{.Health}}' | awk '$2 != "" && $2 != "healthy" {print $1}')
  if [ -n "$unhealthy" ]; then
    echo "WARN: unhealthy containers: $unhealthy" >&2
  else
    echo "OK: all containers healthy"
  fi
  ping_switch
}

snapshot_langfuse() {
  # Snapshot the Langfuse Postgres volume - run BEFORE any Langfuse upgrade.
  # Stop the web+worker first for a consistent snapshot, then restart.
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup_dir="${BACKUP_DIR:-/opt/backups/langfuse}"
  mkdir -p "$backup_dir"
  echo "Stopping Langfuse web+worker for a consistent snapshot..."
  docker compose -f "$COMPOSE_FILE" stop langfuse-web langfuse-worker
  docker run --rm \
    -v bgb-rag_langfuse-postgres:/source:ro \
    -v "$backup_dir":/backup \
    alpine tar czf "/backup/langfuse-postgres-$stamp.tar.gz" -C /source .
  docker compose -f "$COMPOSE_FILE" start langfuse-web langfuse-worker
  echo "Snapshot written: $backup_dir/langfuse-postgres-$stamp.tar.gz"
  ping_switch
}

case "${1:-}" in
  --snapshot) snapshot_langfuse ;;
  --nightly) nightly_checks ;;
  "") keep_warm ;;
  *) echo "usage: $0 [--nightly|--snapshot]" >&2; exit 2 ;;
esac
