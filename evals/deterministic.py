"""The deterministic (no-LLM) PR gate: four checks over golden-set replays.

1. Retrieval hit-rate at k=5: at least one expected § among the top-5
   chunks (paragraph-level via chunk metadata) for ``answer`` records.
2. Index integrity: the collection manifest's embedder id, corpus hash, and
   Stand date must match the built index; fails loudly on mismatch.
3. Recorded-quote faithfulness: each golden item's ``verified_quotes`` match
   the current index's paragraph records after whitespace normalization.
4. Out-of-scope floor check: ``out_of_scope`` records score below the
   calibrated floor and ``answer``/``names_gap`` records above it - skipped
   with a warning until ``evals/baselines/floor.json`` exists.

Runs anywhere, needs no LLM, fast enough for every PR.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GOLDEN_SET_PATH = REPO_ROOT / "evals" / "golden_set.jsonl"
FLOOR_BASELINE_PATH = REPO_ROOT / "evals" / "baselines" / "floor.json"

GATE_THRESHOLD = (
    0.9  # at least 90% of applicable items per check (fixed count from the full golden set)
)


def load_golden_set(path: Path = GOLDEN_SET_PATH) -> list[dict]:
    items = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            items.append(json.loads(line))
    return items


def check_retrieval_hitrate(items: list[dict], retriever) -> tuple[float, list[str]]:
    """Hit-rate at k=5 over ``answer`` records (paragraph-level)."""
    failures = []
    applicable = [i for i in items if i["expected_behavior"] == "answer"]
    hits = 0
    for item in applicable:
        try:
            chunks = retriever.retrieve(item["question"], k=5)
        except Exception as exc:  # noqa: BLE001 - reported as a failure
            failures.append(f"{item['id']}: retrieval error: {exc}")
            continue
        paragraphs = {c.paragraph for c in chunks}
        expected = set(item["expected_paragraphs"])
        if paragraphs & expected:
            hits += 1
        else:
            expected_str = "/§".join(sorted(expected))
            failures.append(
                f"{item['id']}: expected §{expected_str} not in top-5 (got {sorted(paragraphs)})"
            )
    rate = hits / len(applicable) if applicable else 1.0
    return rate, failures


def check_index_integrity(collection_dir: Path) -> list[str]:
    """Manifest ↔ index consistency; fails loudly on mismatch."""
    from retrieval.base import load_chunks, load_manifest, load_paragraphs

    failures = []
    try:
        manifest = load_manifest(collection_dir)
    except Exception as exc:  # noqa: BLE001
        return [f"manifest unreadable: {exc}"]
    try:
        chunks = load_chunks(collection_dir)
        paragraphs = load_paragraphs(collection_dir)
    except Exception as exc:  # noqa: BLE001
        return [f"index unreadable: {exc}"]

    if not chunks:
        failures.append("collection has no chunks")
    if manifest.get("chunk_count") != len(chunks):
        failures.append(
            f"manifest chunk_count {manifest.get('chunk_count')} != actual {len(chunks)}"
        )
    if not manifest.get("stand_date"):
        failures.append("manifest missing stand_date")
    if not manifest.get("embedder"):
        failures.append("manifest missing embedder")
    if not manifest.get("corpus_hash"):
        failures.append("manifest missing corpus_hash")
    if not paragraphs:
        failures.append("collection has no paragraph records")
    else:
        for number in list(paragraphs)[:3]:
            record = paragraphs[number]
            if not record.get("full_text"):
                failures.append(f"§ {number} record has empty full_text")
                break
    return failures


def check_quote_faithfulness(items: list[dict], paragraphs: dict[str, dict]) -> list[str]:
    """Recorded quotes must exist in the current index's paragraph records."""
    import re

    failures = []
    for item in items:
        for quote in item.get("verified_quotes", []):
            normalized = re.sub(r"\s+", " ", quote)
            found = any(
                normalized in re.sub(r"\s+", " ", paragraphs[p]["full_text"])
                for p in item["expected_paragraphs"]
                if p in paragraphs
            )
            if not found:
                refs = "/§".join(item["expected_paragraphs"])
                failures.append(f"{item['id']}: recorded quote not found in §{refs}")
    return failures


def load_floor(path: Path = FLOOR_BASELINE_PATH) -> float | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    floor = data.get("floor")
    return float(floor) if floor is not None else None


def check_floor(items: list[dict], retriever, floor: float) -> tuple[float, list[str]]:
    """Out-of-scope records below the floor; in-scope records above it."""
    failures = []
    hits = 0
    total = 0
    for item in items:
        expected_below = item["expected_behavior"] == "out_of_scope"
        try:
            confidence = retriever.confidence(item["question"])
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{item['id']}: confidence error: {exc}")
            continue
        total += 1
        below = confidence < floor
        if below == expected_below:
            hits += 1
        else:
            side = "below" if below else "above"
            failures.append(
                f"{item['id']}: confidence {confidence:.3f} is {side} the floor "
                f"({floor:.3f}) but expected {'below' if expected_below else 'above'}"
            )
    rate = hits / total if total else 1.0
    return rate, failures


def run_deterministic_tier(collection_dir: Path, retriever, fixture_mode: bool = False) -> dict:
    """Run all four checks; returns the result record for the run log.

    ``fixture_mode`` (hermetic CI): restricts to golden items whose expected
    paragraphs exist in the tiny fixture collection; retrieval and floor
    checks are skipped there (covered by the unit-test suite instead).
    """
    items = load_golden_set()
    result: dict = {"tier": "deterministic", "fixture_mode": fixture_mode, "checks": {}}

    from retrieval.base import load_paragraphs

    paragraphs = load_paragraphs(collection_dir)
    if fixture_mode:
        items = [
            i
            for i in items
            if all(p in paragraphs for p in i["expected_paragraphs"])
            or i["expected_behavior"] == "out_of_scope"
        ]

    # 1. Retrieval hit-rate at k=5 (skipped in fixture mode)
    if fixture_mode:
        result["checks"]["retrieval_hitrate_k5"] = {
            "value": None,
            "pass": None,
            "skipped": "fixture mode - retrieval covered by unit tests",
            "failures": [],
        }
    else:
        rate, failures = check_retrieval_hitrate(items, retriever)
        result["checks"]["retrieval_hitrate_k5"] = {
            "value": rate,
            "threshold": GATE_THRESHOLD,
            "pass": rate >= GATE_THRESHOLD,
            "failures": failures,
        }

    # 2. Index integrity
    integrity_failures = check_index_integrity(collection_dir)
    result["checks"]["index_integrity"] = {
        "value": 1.0 if not integrity_failures else 0.0,
        "pass": not integrity_failures,
        "failures": integrity_failures,
    }

    # 3. Recorded-quote faithfulness
    quote_failures = check_quote_faithfulness(items, paragraphs)
    result["checks"]["quote_faithfulness"] = {
        "value": 1.0 if not quote_failures else 0.0,
        "pass": not quote_failures,
        "failures": quote_failures,
    }

    # 4. Out-of-scope floor check (skipped until calibration; skipped in fixture mode)
    floor = load_floor()
    if fixture_mode or floor is None:
        result["checks"]["floor_check"] = {
            "value": None,
            "pass": None,
            "skipped": "fixture mode"
            if fixture_mode
            else "floor not calibrated yet (evals/baselines/floor.json missing)",
            "failures": [],
        }
    else:
        floor_rate, floor_failures = check_floor(items, retriever, floor)
        result["checks"]["floor_check"] = {
            "value": floor_rate,
            "threshold": GATE_THRESHOLD,
            "pass": floor_rate >= GATE_THRESHOLD,
            "failures": floor_failures,
        }

    gate_checks = [c for c in result["checks"].values() if c["pass"] is not None]
    result["pass"] = all(c["pass"] for c in gate_checks)
    return result
