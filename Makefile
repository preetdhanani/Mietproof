.PHONY: up down ingest ask eval-gate eval-full compare stand-diff rebuild test lint

# Start the app stack (app + deps, no Langfuse by default for local dev)
up:
	docker compose -f deploy/docker-compose.prod.yml up -d app

down:
	docker compose -f deploy/docker-compose.prod.yml down

# One-command corpus build: fetch -> parse -> gloss -> chunk -> embed -> index
ingest:
	uv run python -m ingestion.ingest

# Curl one-liner against /ask
ask:
	curl -s -X POST http://localhost:8000/ask -H "Content-Type: application/json" \
		-d '{"question": "How much notice must I give before ending my lease?"}' | head -c 2000

# Deterministic tier (no LLM) - the PR gate
eval-gate:
	uv run python -m evals.run_eval --tier deterministic

# Stand-diff check: golden items needing re-verification
stand-diff:
	uv run python -m evals.stand_diff

# Scheduled RAGAS tier
eval-full:
	uv run python -m evals.run_eval --tier full

# Retrieval backend comparison
compare:
	uv run python -m evals.run_eval --tier compare

# Full from-source rebuild: fetch -> parse -> chunk -> embed -> index -> smoke test
rebuild:
	uv run python -m ingestion.ingest && uv run python -m evals.run_eval --tier deterministic

test:
	uv run pytest

lint:
	uv run ruff check .
	uv run ruff format --check .

# React debug UI (dev server with proxy to the API)
ui:
	cd ui && npm run dev

# Build the UI for production (served by Caddy)
ui-build:
	cd ui && npm run build
