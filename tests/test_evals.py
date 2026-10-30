"""Deterministic eval tier: check logic, golden-set schema, Stand-diff."""

from __future__ import annotations

from pathlib import Path

from evals.deterministic import (
    check_index_integrity,
    check_quote_faithfulness,
    check_retrieval_hitrate,
    load_floor,
    load_golden_set,
)
from evals.stand_diff import run_stand_diff
from retrieval.dense import DenseRetriever

FIXTURE = Path(__file__).parent / "fixtures" / "collection"


def make_retriever():
    from sentence_transformers import SentenceTransformer

    from ingestion.embed import Embedder

    wrapper = Embedder.__new__(Embedder)
    wrapper.model_name = "intfloat/multilingual-e5-base"
    wrapper._model = SentenceTransformer("intfloat/multilingual-e5-base")
    return DenseRetriever(FIXTURE, model=wrapper)


def test_golden_set_schema() -> None:
    items = load_golden_set()
    assert len(items) >= 10, "build step 3 requires at least 10 pairs"
    required = {
        "schema_version",
        "id",
        "question",
        "expected_paragraphs",
        "expected_answer_points",
        "verified_quotes",
        "expected_behavior",
        "law",
        "verified_against_stand",
        "verification_date",
        "notes",
    }
    behaviors = set()
    for item in items:
        assert required <= set(item), f"{item['id']} missing fields"
        assert item["expected_behavior"] in ("answer", "names_gap", "out_of_scope")
        behaviors.add(item["expected_behavior"])
    assert behaviors == {"answer", "names_gap", "out_of_scope"}, "all three behaviors covered"
    # at least 2 out-of-scope cases per the build plan
    oos = [i for i in items if i["expected_behavior"] == "out_of_scope"]
    assert len(oos) >= 2


def test_golden_set_quotes_exist_in_real_corpus() -> None:
    """Every recorded quote must exist in the committed snapshot (skipped
    when the snapshot is absent, e.g. on CI checkouts without corpus)."""
    snapshot = Path(__file__).parent.parent / "corpus" / "snapshots" / "2026-07-23" / "bgb.xml"
    if not snapshot.exists():
        return
    import re

    from ingestion.parse import parse_bgb_xml

    full = {r.number: r.full_text for r in parse_bgb_xml(snapshot.read_bytes())}
    for item in load_golden_set():
        for quote in item["verified_quotes"]:
            normalized = re.sub(r"\s+", " ", quote)
            assert any(
                normalized in re.sub(r"\s+", " ", full[p]) for p in item["expected_paragraphs"]
            ), f"{item['id']}: quote not in corpus"


def test_retrieval_hitrate_check() -> None:
    retriever = make_retriever()
    items = [
        {
            "id": "t1",
            "question": "How much notice must I give before ending my lease?",
            "expected_paragraphs": ["573c"],
            "expected_behavior": "answer",
        },
        {
            "id": "t2",
            "question": "What is the capital of France?",
            "expected_paragraphs": ["999"],
            "expected_behavior": "answer",
        },
    ]
    rate, failures = check_retrieval_hitrate(items, retriever)
    assert rate == 0.5
    assert len(failures) == 1 and "t2" in failures[0]


def test_quote_faithfulness_check() -> None:
    from retrieval.base import load_paragraphs

    paragraphs = load_paragraphs(FIXTURE)
    items = [
        {
            "id": "good",
            "expected_paragraphs": ["542"],
            "verified_quotes": [
                "Ist die Mietzeit nicht bestimmt, so kann jede Vertragspartei "
                "das Mietverhältnis nach den gesetzlichen Vorschriften kündigen."
            ],
        },
        {
            "id": "bad",
            "expected_paragraphs": ["542"],
            "verified_quotes": ["Diese Formulierung steht nirgendwo im Gesetzestext."],
        },
    ]
    failures = check_quote_faithfulness(items, paragraphs)
    assert len(failures) == 1 and "bad" in failures[0]


def test_index_integrity_check() -> None:
    failures = check_index_integrity(FIXTURE)
    assert failures == [], failures
    failures = check_index_integrity(Path(__file__))
    assert failures  # a non-collection must fail loudly


def test_floor_load() -> None:
    assert load_floor(Path("nonexistent.json")) is None


def test_stand_diff_clean_on_current_corpus() -> None:
    flagged = run_stand_diff()
    assert flagged == [], flagged
