"""CLI entry point for all eval tiers.

``--tier deterministic|full|compare`` and ``--collection <name>`` (targets
the checks at a candidate collection - this is how cutover gating runs
before ``ACTIVE_COLLECTION`` flips). Appends one record per run to the
append-only run log with the full configuration tuple: corpus Stand date,
embedding model, generator model, judge model, prompt version, eval-library
version, metric values, per-question results path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

RUN_LOG_PATH = REPO_ROOT / "evals" / "run_log.jsonl"
DEFAULT_COLLECTIONS_DIR = REPO_ROOT / "data" / "collections"


def prompt_version() -> str:
    """Hash of the versioned prompt artifacts."""
    hasher = hashlib.sha256()
    prompts = REPO_ROOT / "app" / "prompts"
    for path in sorted(prompts.glob("*.md")):
        hasher.update(path.name.encode())
        hasher.update(path.read_bytes())
    return hasher.hexdigest()[:12]


def append_run_log(record: dict, log_path: Path = RUN_LOG_PATH) -> Path:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return log_path


def resolve_collection(name: str | None) -> Path:
    if name == "fixture" or os.environ.get("EVAL_FIXTURE_COLLECTION"):
        # Hermetic CI mode: the tiny committed fixture collection. Its golden
        # expectations are covered by tests/test_retrieval.py; the deterministic
        # tier runs against the REAL collection locally (it needs the full corpus).
        fixture = REPO_ROOT / "tests" / "fixtures" / "collection"
        if fixture.exists():
            return fixture
        print("Fixture collection missing (tests/fixtures/collection)", file=sys.stderr)
        sys.exit(2)
    from app.config import get_settings

    settings = get_settings()
    candidate_name = name or settings.ACTIVE_COLLECTION
    if not candidate_name:
        print(
            "No collection selected: pass --collection or set ACTIVE_COLLECTION "
            "(available: "
            + ", ".join(
                sorted(p.name for p in DEFAULT_COLLECTIONS_DIR.glob("bgb__*") if p.is_dir())
            )
            + ")",
            file=sys.stderr,
        )
        sys.exit(2)
    candidate = DEFAULT_COLLECTIONS_DIR / candidate_name
    if not candidate.exists():
        print(f"Collection {candidate_name!r} not found at {candidate}", file=sys.stderr)
        sys.exit(2)
    return candidate


def run_deterministic(collection: Path) -> dict:
    from evals.deterministic import run_deterministic_tier
    from retrieval.factory import build_retriever

    fixture_mode = collection.name == "collection" and "fixtures" in str(collection)
    retriever = build_retriever(collection)
    return run_deterministic_tier(collection, retriever, fixture_mode=fixture_mode)


def run_compare(collection: Path) -> dict:
    from retrieval.compare import run_comparison

    return run_comparison(collection)


def run_full(collection: Path) -> dict:
    from evals.ragas_adapter import run_ragas_tier

    return run_ragas_tier(collection)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tier", choices=["deterministic", "full", "compare"], required=True)
    parser.add_argument("--collection", help="Collection name (defaults to ACTIVE_COLLECTION)")
    parser.add_argument("--no-log", action="store_true", help="Skip the run-log append")
    args = parser.parse_args(argv)

    from app.config import get_settings

    settings = get_settings()
    collection = resolve_collection(args.collection)

    started = time.time()
    if args.tier == "deterministic":
        result = run_deterministic(collection)
    elif args.tier == "compare":
        result = run_compare(collection)
    else:
        result = run_full(collection)
    elapsed = time.time() - started

    # Print a human-readable summary
    if args.tier == "deterministic":
        for name, check in result["checks"].items():
            if check.get("pass") is None:
                print(f"SKIP  {name}: {check.get('skipped', '')}")
            else:
                value = check.get("value")
                shown = value if value is None else round(value, 3)
                print(f"{'PASS' if check['pass'] else 'FAIL'}  {name}: {shown}")
                for failure in check.get("failures", [])[:8]:
                    print(f"        - {failure}")
        print(f"Gate: {'PASS' if result['pass'] else 'FAIL'}")
    else:
        print(json.dumps(result, ensure_ascii=False, indent=1)[:4000])

    if not args.no_log:
        manifest = json.loads((collection / "manifest.json").read_text(encoding="utf-8"))
        record = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "tier": args.tier,
            "collection": collection.name,
            "corpus_stand": manifest.get("stand_date"),
            "embedding_model": manifest.get("embedder"),
            "generator_model": settings.LLM_MODEL or None,
            "judge_model": settings.JUDGE_MODEL or settings.LLM_MODEL or None,
            "prompt_version": prompt_version(),
            "retrieval_backend": settings.RETRIEVAL_BACKEND,
            "elapsed_seconds": round(elapsed, 1),
            "result": result,
        }
        log_path = append_run_log(record)
        print(f"Run log: {log_path}")

    if args.tier == "deterministic" and not result["pass"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
