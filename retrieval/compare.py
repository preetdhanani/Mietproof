"""Retrieval-backend comparison runner.

Executes all three arms (BM25, dense, hybrid) over the golden set, computes
retrieval hit-rate at k=5 and measured p95 latency per arm, applies the
fixed decision rule, and emits a Markdown table plus JSON. Output is
committed under ``evals/results/`` and linked from the README.

Decision rule (fixed before the experiment runs):
1. Highest hit-rate at k=5 wins.
2. If the top two are within 5 percentage points, lower p95 wins.
3. If still tied, the simpler backend wins (BM25 over dense over hybrid).
4. No backend ships unless its hit-rate meets the deterministic gate's
   threshold; otherwise the fallback order is hybrid tuning, query
   translation, scoping the README claim.
"""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path

from evals.deterministic import GATE_THRESHOLD, load_golden_set
from retrieval.base import Retriever

REPO_ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = REPO_ROOT / "evals" / "results"

SIMPLICITY_ORDER = {"bm25": 0, "dense": 1, "hybrid": 2}


def measure_arm(name: str, retriever: Retriever, items: list[dict], k: int = 5) -> dict:
    hits = 0
    applicable = 0
    latencies: list[float] = []
    per_item = []
    for item in items:
        if item["expected_behavior"] != "answer":
            continue
        applicable += 1
        started = time.perf_counter()
        try:
            chunks = retriever.retrieve(item["question"], k=k)
        except Exception as exc:  # noqa: BLE001 - recorded, not raised
            per_item.append({"id": item["id"], "hit": False, "error": str(exc)})
            latencies.append(time.perf_counter() - started)
            continue
        latencies.append(time.perf_counter() - started)
        paragraphs = {c.paragraph for c in chunks}
        hit = bool(paragraphs & set(item["expected_paragraphs"]))
        hits += hit
        per_item.append({"id": item["id"], "hit": hit, "top5": sorted(paragraphs)})
    rate = hits / applicable if applicable else 0.0
    p95 = (
        statistics.quantiles(latencies, n=20)[-1] * 1000
        if len(latencies) >= 2
        else (latencies[0] * 1000 if latencies else 0.0)
    )
    return {
        "backend": name,
        "hitrate_k5": rate,
        "hits": hits,
        "applicable": applicable,
        "p95_ms": round(p95, 1),
        "meets_gate": rate >= GATE_THRESHOLD,
        "per_item": per_item,
    }


def decide(results: list[dict]) -> str:
    """Apply the fixed decision rule; returns the winning backend name."""
    eligible = [r for r in results if r["meets_gate"]]
    if not eligible:
        return ""  # no backend ships - fallback order applies
    best_rate = max(r["hitrate_k5"] for r in eligible)
    top = [r for r in eligible if best_rate - r["hitrate_k5"] <= 0.05]
    if len(top) == 1:
        return top[0]["backend"]
    by_latency = min(top, key=lambda r: r["p95_ms"])
    within_latency = [r for r in top if r["p95_ms"] - by_latency["p95_ms"] <= 1.0]
    if len(within_latency) == 1:
        return by_latency["backend"]
    winner = min(within_latency, key=lambda r: SIMPLICITY_ORDER[r["backend"]])
    return winner["backend"]


def run_comparison(collection_dir: Path, retrievers: dict[str, Retriever] | None = None) -> dict:
    items = load_golden_set()
    if retrievers is None:
        from retrieval.bm25 import BM25Retriever
        from retrieval.dense import DenseRetriever
        from retrieval.hybrid import HybridRetriever

        retrievers = {
            "bm25": BM25Retriever(collection_dir),
            "dense": DenseRetriever(collection_dir),
            "hybrid": HybridRetriever(collection_dir),
        }
    results = [measure_arm(name, retriever, items) for name, retriever in retrievers.items()]
    winner = decide(results)
    return {
        "collection": collection_dir.name,
        "results": results,
        "winner": winner,
        "decision_rule": "highest hit-rate k=5; within 5pp -> lower p95; tied -> simpler backend",
    }


def write_results(result: dict, results_dir: Path = RESULTS_DIR) -> tuple[Path, Path]:
    """Write the JSON record and the Markdown table; returns both paths."""
    results_dir.mkdir(parents=True, exist_ok=True)
    json_path = results_dir / "retrieval_comparison.json"
    md_path = results_dir / "retrieval_comparison.md"

    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    lines = [
        "# Retrieval backend comparison",
        "",
        f"Collection: `{result['collection']}`",
        "",
        "| Backend | Hit-rate @ k=5 | Hits | p95 latency (ms) | Meets gate |",
        "|---|---|---|---|---|",
    ]
    for arm in sorted(result["results"], key=lambda r: -r["hitrate_k5"]):
        lines.append(
            f"| {arm['backend']} | {arm['hitrate_k5']:.0%} | {arm['hits']}/{arm['applicable']} "
            f"| {arm['p95_ms']} | {'yes' if arm['meets_gate'] else 'no'} |"
        )
    lines += [
        "",
        f"Decision rule: {result['decision_rule']}",
        f"**Shipped default: {result['winner'] or '(none meets the gate - fallback applies)'}**",
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path
