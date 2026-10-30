"""Retrieval interface conformance for all backends plus known-query smoke
checks against the tiny fixture corpus."""

from __future__ import annotations

from pathlib import Path

import pytest
from sentence_transformers import SentenceTransformer

from retrieval.base import Retriever, load_manifest
from retrieval.dense import DenseRetriever

FIXTURE = Path(__file__).parent / "fixtures" / "collection"


@pytest.fixture(scope="module")
def st_model():
    return SentenceTransformer("intfloat/multilingual-e5-base")


@pytest.fixture
def dense(st_model) -> DenseRetriever:
    from ingestion.embed import Embedder

    wrapper = Embedder.__new__(Embedder)  # skip __init__ (no model reload)
    wrapper.model_name = "intfloat/multilingual-e5-base"
    wrapper._model = st_model
    return DenseRetriever(FIXTURE, model=wrapper)


def test_manifest_fixture_integrity() -> None:
    manifest = load_manifest(FIXTURE)
    assert manifest["stand_date"] == "2026-07-23"
    assert manifest["laws"] == ["BGB"]
    assert manifest["chunk_count"] > 0


def test_dense_conforms_to_protocol(dense: DenseRetriever) -> None:
    assert isinstance(dense, Retriever)


def test_retrieve_returns_ranked_metadata_complete_chunks(dense: DenseRetriever) -> None:
    hits = dense.retrieve("How much notice must I give before ending my lease?", k=3)
    assert len(hits) == 3
    scores = [h.score for h in hits]
    assert scores == sorted(scores, reverse=True)
    for position, hit in enumerate(hits, start=1):
        assert hit.index == position
        assert hit.law_abbr == "BGB"
        assert hit.paragraph
        assert hit.stand_date == "2026-07-23"
        assert hit.chunk_text


def test_known_query_hits_notice_period(dense: DenseRetriever) -> None:
    # § 573c (Kündigungsfristen) is in the fixture corpus.
    hits = dense.retrieve("How much notice must I give before ending my lease?", k=5)
    paragraphs = [h.paragraph for h in hits]
    assert "573c" in paragraphs


def test_known_query_hits_deposit(dense: DenseRetriever) -> None:
    # § 551 (Sicherheitsleistung) is in the fixture corpus.
    hits = dense.retrieve("Can my landlord keep my security deposit?", k=5)
    paragraphs = [h.paragraph for h in hits]
    assert "551" in paragraphs


def test_known_query_hits_rent_increase(dense: DenseRetriever) -> None:
    # § 558 (Mieterhöhung) is in the fixture corpus.
    hits = dense.retrieve("When can my landlord raise the rent?", k=5)
    paragraphs = [h.paragraph for h in hits]
    assert "558" in paragraphs


def test_confidence_in_unit_interval(dense: DenseRetriever) -> None:
    for query in ("notice period", "Was ist das Wetter in Berlin?", ""):
        value = dense.confidence(query)
        assert 0.0 <= value <= 1.0


def test_empty_query_still_returns_chunks(dense: DenseRetriever) -> None:
    hits = dense.retrieve("", k=2)
    assert len(hits) == 2


def test_missing_collection_raises(tmp_path: Path) -> None:
    with pytest.raises((ValueError, FileNotFoundError)):
        DenseRetriever(tmp_path, model=None)


# --- BM25 and hybrid backends (build step 4) ---


def test_bm25_conforms_to_protocol() -> None:
    from retrieval.bm25 import BM25Retriever

    assert isinstance(BM25Retriever(FIXTURE), Retriever)


def test_hybrid_conforms_to_protocol(st_model) -> None:
    from ingestion.embed import Embedder
    from retrieval.hybrid import HybridRetriever

    wrapper = Embedder.__new__(Embedder)
    wrapper.model_name = "intfloat/multilingual-e5-base"
    wrapper._model = st_model
    assert isinstance(HybridRetriever(FIXTURE, model=wrapper), Retriever)


def test_bm25_german_query_hits_relevant_paragraph() -> None:
    # BM25 works when the query shares vocabulary with the corpus.
    from retrieval.bm25 import BM25Retriever

    bm25 = BM25Retriever(FIXTURE)
    hits = bm25.retrieve("Kündigungsfrist Mietverhältnis kündigen", k=5)
    paragraphs = [h.paragraph for h in hits]
    assert "573c" in paragraphs or "542" in paragraphs


def test_hybrid_retrieval_merges_both_backends(st_model) -> None:
    from ingestion.embed import Embedder
    from retrieval.hybrid import HybridRetriever

    wrapper = Embedder.__new__(Embedder)
    wrapper.model_name = "intfloat/multilingual-e5-base"
    wrapper._model = st_model
    hybrid = HybridRetriever(FIXTURE, model=wrapper)
    hits = hybrid.retrieve("How much notice must I give before ending my lease?", k=5)
    assert len(hits) == 5
    assert [h.index for h in hits] == [1, 2, 3, 4, 5]
    assert hits[0].score >= hits[-1].score


def test_compare_decision_rule() -> None:
    from retrieval.compare import decide

    results = [
        {"backend": "bm25", "hitrate_k5": 0.0, "p95_ms": 1.0, "meets_gate": False},
        {"backend": "dense", "hitrate_k5": 0.9, "p95_ms": 40.0, "meets_gate": True},
        {"backend": "hybrid", "hitrate_k5": 0.9, "p95_ms": 15.0, "meets_gate": True},
    ]
    # Tie on hit-rate, hybrid has lower p95 -> hybrid wins.
    assert decide(results) == "hybrid"


def test_compare_no_backend_ships_below_gate() -> None:
    from retrieval.compare import decide

    results = [
        {"backend": "dense", "hitrate_k5": 0.5, "p95_ms": 40.0, "meets_gate": False},
    ]
    assert decide(results) == ""


def test_compare_simplicity_tiebreak() -> None:
    from retrieval.compare import decide

    results = [
        {"backend": "dense", "hitrate_k5": 0.9, "p95_ms": 15.0, "meets_gate": True},
        {"backend": "hybrid", "hitrate_k5": 0.9, "p95_ms": 15.0, "meets_gate": True},
    ]
    # Same rate, same latency -> the simpler backend (dense) wins.
    assert decide(results) == "dense"
