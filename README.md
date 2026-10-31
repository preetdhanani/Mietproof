# BGB Rental Law RAG

Ask German rental law questions in English.
Get an answer that cites the exact BGB paragraph.
Watch every step of the backend while it works.

![The thinking feed: search, re-ranking, LLM, verification, then the answer](docs/demo.gif)

General statutory information, not legal advice.

## About me

I'm Prit Dhanani, a master's student in AI.
I built this project to learn what a RAG system needs beyond a demo: measured retrieval, citations you can check, evals that block bad changes, and a UI that shows its work.
Every number in this README comes from running the system.

## The data is current

| | |
|---|---|
| Law | German Civil Code (BGB), rental law §§ 535-580a |
| Source | Official XML from [gesetze-im-internet.de](https://www.gesetze-im-internet.de/bgb/) |
| Version | "zuletzt geändert durch Art. 6 G v. 23.7.2026 I Nr. 226" |
| Checked | 31 October 2026, against the official site: same version, no newer change |
| Size | 105 paragraphs, split into 298 chunks (one per Absatz) |
| Extras | An English gloss for every paragraph, shown next to the German text |

`make stand-diff` lists the eval questions to re-check when a new version of the law appears.

## What happens when you ask

![Chat with the thinking feed on the left, the Diagnose panel on the right](docs/screenshots/02-hero.png)

Left: the chat.
Each step appears in a "thinking" feed, then the answer.
Right: the Diagnose panel with the full detail of every step.

Retrieval takes under 100 ms, too fast to watch.
The feed replays the real results at reading speed while the LLM works, and every step shows its real time.

### 1-3. Read the question and search twice

![Query, BM25 and semantic search steps](docs/screenshots/03-feed-search.png)

- The question is searched two ways.
- Keyword search (BM25) scores all 298 chunks by shared words.
  Struck-through words do not appear in the statute.
  Here the only match is "i", from citations like "BGBl. I".
  English and German share almost no words.
- Semantic search turns the question into 768 numbers (multilingual-e5) and compares it with all 105 paragraphs by cosine similarity.
  It works across languages.
- German legal terms from a small lexicon (Kündigungsfrist, Kündigung, ...) help the semantic search.

### 4. Re-ranking (fusion)

![Both rankings merged by reciprocal rank fusion](docs/screenshots/04-feed-rerank.png)

- Reciprocal rank fusion merges the two lists by position: `score = Σ weight / (60 + rank)`.
- Semantic counts twice as much as BM25 (tuned on the eval set).
- The top 5 chunks go to the LLM.
  The rest are dropped.

### 5-8. Gate, prompt, LLM, verify

![Scope gate, prompt, LLM reasoning and citation checks](docs/screenshots/05-feed-generate.png)

- Scope gate: if even the best match is weak, the system declines and never calls the LLM.
  The floor (0.899) is calibrated on labelled in-scope and out-of-scope questions.
- Prompt: answer rules, the 5 chunks, the question.
- LLM: streams its reasoning, then the answer.
  First token after about 1 second.
- Verify: every `[n]` must point to a chunk the model received, every § must exist, every German quote must appear word for word.
  A failed draft is retried once with the failures as feedback, then refused.

### The answer

![Verified answer with its sources](docs/screenshots/06-answer.png)

The model writes `[1]`, `[2]`.
The code turns them into § numbers from chunk metadata, so the model cannot invent a paragraph.
Each source links to the official text.

### Follow-ups and off-topic questions

![Follow-up rewritten by the LLM before search](docs/screenshots/07-feed-followup.png)

A short follow-up ("And what if I am the landlord?") is rewritten into a standalone question before search.

![Out-of-scope question declined by the scope gate](docs/screenshots/08-out-of-scope.png)

"Best pizza in Berlin" scores 0.876, below the floor.
The reply lists the covered topics.
No LLM call, no tokens spent.

## The Diagnose panel

One tab per step, with the real numbers.
It follows the running step live and opens full width.

### Overview

Time to answer, first token, tokens, checks, the retrieval funnel (298 chunks down to 5) and a timeline.
The LLM is over 99% of the wait.

![Overview tab](docs/screenshots/10-diagnose-overview.png)

### Query

What each search really receives.
BM25 gets the raw question; semantic search gets the question plus German terms.

![Query tab](docs/screenshots/11-diagnose-query.png)

### BM25

The formula, its parameters, and each hit split by the words that scored.
Accidental matches are flagged.

![BM25 tab](docs/screenshots/12-diagnose-bm25.png)

### Semantic

A map of all 105 paragraphs around the question (closer = more similar), the top 10, and the scope gate math.

![Semantic tab](docs/screenshots/13-diagnose-semantic.png)

### Fusion

Each candidate's BM25 rank, semantic rank, RRF score, and the cut line for the LLM.

![Fusion tab](docs/screenshots/14-diagnose-fusion.png)

### Prompt

The exact messages sent, and what the context window is spent on.

![Prompt tab](docs/screenshots/15-diagnose-prompt.png)

### LLM

Model, first token, tokens, the streamed reasoning and the raw output.

![LLM tab](docs/screenshots/16-diagnose-llm.png)

### Verify

Every check that ran, and where each `[n]` links.

![Verify tab](docs/screenshots/17-diagnose-verify.png)

It works on a phone too:

<img src="docs/screenshots/09-phone.png" alt="Thinking feed on a phone" width="320">

## Architecture

```mermaid
flowchart LR
    ui["React UI"] -->|"POST /ask/stream (NDJSON)"| api["FastAPI"]
    api --> q["Query: German check, follow-up rewrite, lexicon"]
    q --> bm25["BM25 over 298 chunks"]
    q --> dense["multilingual-e5 over 105 paragraphs"]
    bm25 --> rrf["RRF fusion, top 5"]
    dense --> rrf
    rrf --> gate{"Confidence ≥ floor?"}
    gate -->|"no"| decline["Covered-topics reply"]
    gate -->|"yes"| llm["LLM (OpenAI-compatible, streamed)"]
    llm --> verify["Citation verifier"]
    verify -->|"fail"| llm
    verify -->|"pass"| answer["Answer + citations from metadata"]
```

- `POST /ask/stream` sends each step as one JSON line the moment it finishes, plus the LLM's streamed text.
- `POST /ask` returns the same answer in one response (add `"debug": true` for the trace).
- `GET /health/ready` names the failing dependency (index, LLM).
- Retrieval runs in-process. 298 chunks do not need a vector database.

## Results

Measured on 30 hand-verified questions with known correct paragraphs.

| Retrieval | Hit rate @ 5 | p95 latency |
|---|---|---|
| Semantic only | 29/30 (97%) | 21.1 ms |
| Hybrid (shipped) | 28/30 (93%) | 12.5 ms |
| BM25 only | 2/30 (7%) | 0.4 ms |

Hybrid ships because it is within 5 points of semantic and faster ([comparison](evals/results/retrieval_comparison.md)).

| Check (runs on every PR) | Result on 31 Oct 2026 |
|---|---|
| Retrieval hit rate @ 5 | 28/30, gate ≥ 90% |
| Index integrity | pass |
| Recorded quotes match the statute | pass |
| Out-of-scope floor | 90%, gate ≥ 90% |
| Unit and API tests | 90 passing |

RAGAS (faithfulness, relevancy) runs on a schedule; the first run is still pending.
Method: [docs/evals.md](docs/evals.md).
Every eval run is logged in [evals/run_log.jsonl](evals/run_log.jsonl).

## What I learned

1. Inspect single requests as well as averages.
   The trace view showed BM25 matching the word "I" to "BGBl. I".
   It also exposed a tokenizer bug that split "Kündigung" into "ku" + "ndigung".
   I fixed it and re-ran the eval: still 28/30, nothing broke.
2. Keyword search fails across languages.
   BM25 alone finds 2 of 30 answers; multilingual embeddings find 29.
3. Keep the LLM away from citation numbers.
   The model only writes `[n]`.
   Code maps `[n]` to a §, and a verifier checks every quote word for word.
4. Stop off-topic questions before the LLM.
   A calibrated confidence floor declines them, so they cost no tokens and get no made-up answer.
5. Almost all the waiting is the LLM.
   Retrieval takes under 100 ms; the LLM takes seconds.
   Streaming the reasoning and showing time to first token makes that wait readable.
6. Reasoning models eat token budgets.
   The follow-up rewrite had 128 tokens, and the model's reasoning used 84 to 116 of them.
   Sometimes nothing was left, and the system silently searched the raw follow-up.
   The budget is now 512 and the fallback shows in the trace.
7. Providers change under you.
   The LLM I started with was removed by the provider during development.
   `/health/ready` reported "Model not found" right away, and the model is one environment variable.
8. Measure what the prompt costs.
   The Prompt tab showed the answer rules are sent twice, about 285 extra tokens per request.
   That fix is next, with an eval run before and after.

## Run it locally

```bash
cp .env.example .env
```

Set `LLM_BASE_URL`, `LLM_MODEL` and `LISA_API` (any OpenAI-compatible endpoint).

```bash
make ingest
```

Downloads the law, splits it into chunks and builds the embeddings (the first run downloads the ~1 GB embedding model).

```bash
uv run uvicorn app.main:app --port 8000
```

```bash
make ui
```

Open http://localhost:5173.

Other commands:

```bash
make test
```

```bash
make eval-gate
```

## Repository layout

| Folder | What is in it |
|---|---|
| `ingestion/` | Fetch, parse, gloss, chunk, embed, index |
| `retrieval/` | BM25, semantic and hybrid search, backend comparison |
| `app/` | FastAPI service, prompts, citation verifier, guardrails, tracing |
| `ui/` | React chat, thinking feed, Diagnose panel |
| `evals/` | Golden set, deterministic gate, RAGAS adapter, run log |
| `deploy/` | Docker Compose, Caddy, maintenance, [runbook](deploy/RUNBOOK.md) |
| `tests/` | Unit, pipeline, streaming and API tests |

## Design choices

- In-process retrieval: a vector database adds a failure mode and no quality at this size.
- Retrieval backend chosen by the comparison run, not by taste.
- Versioned collections (`bgb__mE5-base__v4`): switching or rolling back is one environment variable.
- Self-hosted Langfuse for traces (optional); the eval run log in the repo is the durable record.
- Guardrails: rate limit per IP, daily token budget, cap on parallel LLM calls.
- Adding another law means a new data pack, a hand-checked golden set and new thresholds.
  The hand-checking is the expensive part.

## Status

- Live demo: pending deployment ([runbook](deploy/RUNBOOK.md)).
- Open: answer rules sent twice in the prompt.
- Open: first scheduled RAGAS run.

MIT License.
