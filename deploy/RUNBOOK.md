# Runbook

One page. Symptom -> likely cause -> check -> fix.

## Demo returns empty answers / errors

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| `/ask` returns 503 "LLM endpoint unavailable" | Generator endpoint down, expired, or key revoked | `docker logs bgb-rag-app-1 \| grep LLM`; `curl $LLM_BASE_URL/models -H "Authorization: Bearer $LISA_API"` from the VM | Fix LISA_API/provider in `.env`, `docker compose up -d app`. If the university endpoint expired: swap provider via `LLM_*` env (the design's contingency rule); if none available, retire the live link and flip the README badge |
| `/ask` returns 429 "daily token budget exhausted" | Daily budget spent | `cat /app/data/token_budget_state.json` (inside the app-data volume) | Waits until UTC midnight, or raise `DAILY_TOKEN_BUDGET` if the endpoint's real limit allows |
| `/ask` returns 429 "server busy" | Concurrency semaphore full | `docker logs` for repeated "concurrency cap" | Transient; if persistent, check for a stuck LLM call (timeout) and restart the app |
| Answers have no citations / refusal body | Citation verification failed twice | Check the response `behavior: refusal`; `docker logs` for verifier failures | Usually a prompt/model mismatch; check the prompt version in the trace, re-ingest if the collection is stale |
| `/health/ready` 503 with `index: ...` | Collection missing or corrupt | `docker exec bgb-rag-app-1 ls /app/data/collections` | Re-run ingestion (`make ingest`), set `ACTIVE_COLLECTION` to the built collection |

## VM unreachable

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Dead-man's switch alert email | VM down, rebooted, or reclaimed by Oracle | OCI console: instance state | If rebooted: `docker compose -f deploy/docker-compose.prod.yml up -d`. If reclaimed: the one-command rebuild restores it (README quickstart); the recorded demo GIF carries the first impression meanwhile |
| Site up but TLS errors | Caddy ACME rate limit or DNS drift | `docker logs bgb-rag-caddy-1` | Fix DNS; Caddy retries issuance automatically |

## Langfuse UI down (non-blocking for answers)

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Traces missing but answers fine | Langfuse stack down - by policy this degrades tracing only | `docker compose ps` | `docker compose up -d` (Langfuse services); answers are unaffected |
| Langfuse web unhealthy after upgrade | Migration or ClickHouse schema issue | `docker logs bgb-rag-langfuse-web-1` | Roll back: restore the pinned image version in `deploy/langfuse/docker-compose.langfuse.yml` and `docker compose up -d`; the Postgres snapshot (below) is the data-level rollback |

## Disk pressure

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Nightly check warns at >= 85% | Docker logs, ClickHouse data, old collections | `df /`; `docker system df` | Docker json-file rotation is configured at the daemon level (`/etc/docker/daemon.json`: `max-size: 10m`, `max-file: 3`) - verify it is active: `docker inspect <c> \| grep LogConfig`. Prune: `docker system prune -f`. Old collections: keep the previous one (rollback), delete older ones from the app-data volume |

## Langfuse upgrade procedure (snapshot first)

1. Snapshot: `deploy/maintenance.sh --snapshot` (stops web+worker, tars the Postgres volume, restarts).
2. Bump the pinned image versions in `deploy/langfuse/docker-compose.langfuse.yml` (web + worker together, same version).
3. `docker compose -f deploy/docker-compose.prod.yml up -d` and watch `docker logs -f bgb-rag-langfuse-web-1` for migrations.
4. Verify: open the Langfuse UI, submit one `/ask`, confirm the trace appears.
5. Rollback if broken: revert the version pins, `docker compose up -d`, restore the snapshot tarball into the `langfuse-postgres` volume if data was migrated forward.

## Docker log rotation (one-time VM setup)

`/etc/docker/daemon.json`:

```json
{"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "3"}}
```

Then `systemctl restart docker`. Applies to newly created containers.

## Cron setup (one-time)

```
*/10 * * * * /opt/bgb-rag/deploy/maintenance.sh
15 3 * * *  /opt/bgb-rag/deploy/maintenance.sh --nightly
0  4 * * 0  /opt/bgb-rag/deploy/maintenance.sh --snapshot
```

Environment for the cron: `APP_URL`, `DEAD_MANS_SWITCH_URL` (healthchecks.io ping URL), `BACKUP_DIR`.
