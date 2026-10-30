# BGB Rental Law RAG Assistant

A question-answering service over German rental law (BGB §§ 535-580a) for
English-speaking expats: ask in plain English, get an answer in English with
paragraph-level citations - the German original, an English gloss, and a
link to the official source at gesetze-im-internet.de. Built as a public,
runnable demonstration of production AI engineering practice: measured
retrieval quality, verifiable citations, automated evaluation with a quality
gate, request tracing, and a deployment that rebuilds from public source
data with one command.

**This is general statutory information, not legal advice.**

## Demo

Live demo: <!-- DEMO-LINK --> _pending deployment_ <!-- /DEMO-LINK -->
Demo status badge: driven by the weekly `demo-status` workflow.

<!-- DEMO-GIF -->
docs/demo.gif - recorded 60-90 second walkthrough (question in, cited answer out).
<!-- /DEMO-GIF -->

## Architecture

```mermaid
flowchart TB
    user["User - Swagger /docs or curl"] -->|"HTTPS"| caddy["Caddy - TLS termination"]
    subgraph vm["Oracle Always Free VM"]
        caddy --> app["FastAPI app - /ask, /health, /health/ready"]
        app --> retrieval["Retrieval - BM25 / dense / hybrid, in-process index"]
        app --> citations["Citation assembly + deterministic verifier"]
        app -.->|"traces"| langfuse["Langfuse - self-hosted"]
    end
    app -->|"chat completions"| llm["LLM endpoint - OpenAI-compatible, env-configured"]
    gh["GitHub Actions - deterministic eval gate, scheduled RAGAS, demo status"] -.->|"evaluates"| app
    monitor["UptimeRobot + healthchecks.io"] -.->|"monitors"| caddy
end
```

## Evaluation results

| Metric | Score | Threshold | Date | Config tuple |
|---|---|---|---|---|
| Retrieval hit-rate @ k=5 (deterministic gate) | 29/30 (96.7%) | >= 90% | 2026-10-30 | e5-base, hybrid, Stand 2026-07-23 |
| Index integrity | PASS | fail-loud | 2026-10-30 | same |
| Recorded-quote faithfulness | PASS | fail-loud | 2026-10-30 | same |
| Out-of-scope floor check | 90% | >= 90% | 2026-10-30 | floor 0.8913 |
| RAGAS faithfulness / relevancy / precision / recall | _pending first scheduled run_ | mean - 2σ bands | - | judge: JUDGE_MODEL |

Methodology: [docs/evals.md](docs/evals.md). Retrieval backend comparison:
[evals/results/retrieval_comparison.md](evals/results/retrieval_comparison.md)
(dense 97% / hybrid 93% / BM25 7% - the cross-lingual loss, measured).
Every run appends to the committed [run log](evals/run_log.jsonl) with the
full configuration tuple.

## Quickstart

```bash
cp .env.example .env        # fill in LLM_BASE_URL / LLM_MODEL / LLM_API_KEY
make up                     # start the stack
make ingest                 # fetch -> parse -> gloss -> chunk -> embed -> index
make ask                    # first answer
```

The first ingestion downloads the embedding model (~1 GB). Measured
clone-to-first-answer: _to be measured on a clean machine_.

## Published SLOs

| Metric | Target | Measured |
|---|---|---|
| p95 end-to-end response | < 20 s | _first-week measurement pending_ |
| LLM error rate | < 1% per day | _pending_ |
| Daily token budget | split demo / eval+ingest | _pending_ |

## Design decisions

- **Self-hosted Langfuse** over Langfuse Cloud: the ops demonstration is
  part of the product; traces are ephemeral by policy (14-day retention),
  the run log in the repo is the durable record. Mitigations: pinned
  images, per-container memory caps, log rotation, nightly checks with a
  dead-man's switch, Postgres snapshot before upgrades.
- **Oracle Always Free VM** over Hugging Face Spaces: accepted risk of idle
  reclamation, mitigated by the keep-warm cron, the one-command rebuild,
  and the recorded demo GIF as the primary asset.
- **In-process retrieval** over a vector-database server: the corpus is
  ~300 chunks; a server would buy a failure mode for no retrieval gain.
  Three pluggable backends; the shipped default is selected by the
  comparison run, not by preference.
- **Adding a law area costs a new pack**: source config, chunking
  decisions, a hand-verified golden set, thresholds. The human
  verification is the expensive part.

## Repository layout

- `ingestion/` - fetch, parse, gloss, chunk, embed, index
- `retrieval/` - BM25, dense, hybrid backends + comparison runner
- `app/` - FastAPI service, prompts, citations, guardrails, tracing
- `evals/` - golden set, deterministic gate, RAGAS adapter, run log
- `deploy/` - compose, Caddy, maintenance, runbook
- `tests/` - five test suites + fixture collection
