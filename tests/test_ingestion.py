"""Ingestion: parse/chunk idempotence, payload metadata completeness
(``gloss_en`` present), manifest correctness, ``paragraphs.jsonl``
well-formedness."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ingestion.chunk import CHUNK_REQUIRED_FIELDS, chunk_paragraphs, write_chunks
from ingestion.embed import (
    MANIFEST_FILENAME,
    collection_name,
    embedder_id,
    next_collection_version,
)
from ingestion.fetch import extract_stand_date
from ingestion.parse import parse_bgb_xml, write_paragraphs

SNAPSHOT = Path(__file__).parent.parent / "corpus" / "snapshots" / "2026-07-23" / "bgb.xml"

pytestmark = pytest.mark.skipif(not SNAPSHOT.exists(), reason="corpus snapshot not present")


@pytest.fixture(scope="module")
def records() -> list:
    return parse_bgb_xml(SNAPSHOT.read_bytes())


def test_parse_covers_rental_range(records) -> None:
    numbers = [r.number for r in records]
    assert numbers[0] == "535"
    assert numbers[-1] == "580a"
    assert len(records) == 105
    assert len(numbers) == len(set(numbers)), "no duplicates"


def test_parse_records_have_heading_and_text(records) -> None:
    for record in records:
        assert record.heading, f"§ {record.number} missing heading"
        assert record.full_text, f"§ {record.number} missing text"
        assert "+++" not in record.full_text, f"§ {record.number} contains editorial notes"


def test_parse_absatz_structure(records) -> None:
    r535 = next(r for r in records if r.number == "535")
    assert [a.number for a in r535.absaetze] == ["1", "2"]
    r538 = next(r for r in records if r.number == "538")  # no Absatz markers
    assert r538.absaetze == []
    assert r538.full_text


def test_parse_idempotent(records) -> None:
    again = parse_bgb_xml(SNAPSHOT.read_bytes())
    assert [r.to_json() for r in again] == [r.to_json() for r in records]


def test_stand_date_extraction() -> None:
    assert extract_stand_date(SNAPSHOT.read_bytes()) == "2026-07-23"


def test_chunk_metadata_completeness(records) -> None:
    chunks = chunk_paragraphs(
        records, {r.number: f"Gloss {r.number}" for r in records}, "2026-07-23"
    )
    for chunk in chunks:
        data = chunk.to_json()
        for field in CHUNK_REQUIRED_FIELDS:
            assert field in data
        assert data["law_abbr"] == "BGB"
        assert data["paragraph"]
        assert data["stand_date"] == "2026-07-23"
        assert data["gloss_en"] == f"Gloss {data['paragraph']}"
        assert data["chunk_text"]


def test_chunk_idempotent(records) -> None:
    glosses = {r.number: f"Gloss {r.number}" for r in records}
    first = [c.to_json() for c in chunk_paragraphs(records, glosses, "2026-07-23")]
    second = [c.to_json() for c in chunk_paragraphs(records, glosses, "2026-07-23")]
    assert first == second


def test_write_chunks_and_paragraphs_wellformed(records, tmp_path) -> None:
    glosses = {r.number: f"Gloss {r.number}" for r in records}
    chunks = chunk_paragraphs(records, glosses, "2026-07-23")
    chunks_path = write_chunks(chunks, tmp_path)
    paragraphs_path = write_paragraphs(records, tmp_path)

    chunk_lines = chunks_path.read_text(encoding="utf-8").strip().split("\n")
    assert len(chunk_lines) == len(chunks)
    for line in chunk_lines:
        assert set(json.loads(line)) == set(CHUNK_REQUIRED_FIELDS)

    paragraph_lines = paragraphs_path.read_text(encoding="utf-8").strip().split("\n")
    assert len(paragraph_lines) == len(records)
    for line in paragraph_lines:
        record = json.loads(line)
        assert {"law_abbr", "number", "heading", "full_text", "absaetze", "deep_link"} <= set(
            record
        )


def test_missing_gloss_still_writes(records, tmp_path) -> None:
    chunks = chunk_paragraphs(records, {}, "2026-07-23")
    chunks_path = write_chunks(chunks, tmp_path)
    first = json.loads(chunks_path.read_text(encoding="utf-8").split("\n")[0])
    assert first["gloss_en"] == ""


def test_collection_versioning(tmp_path) -> None:
    assert next_collection_version(tmp_path, "mE5-base") == 1
    (tmp_path / collection_name("mE5-base", 1)).mkdir()
    assert next_collection_version(tmp_path, "mE5-base") == 2
    (tmp_path / collection_name("bge-m3", 1)).mkdir()
    assert next_collection_version(tmp_path, "mE5-base") == 2  # unaffected by other embedders


def test_embedder_id_mapping() -> None:
    assert embedder_id("intfloat/multilingual-e5-base") == "mE5-base"
    assert embedder_id("BAAI/bge-m3") == "bge-m3"
    assert "/" not in embedder_id("some/unknown-model")


def test_manifest_written(records, tmp_path) -> None:
    from ingestion.embed import write_collection

    glosses = {r.number: f"Gloss {r.number}" for r in records}
    chunks = chunk_paragraphs(records, glosses, "2026-07-23")
    paragraphs_path = write_paragraphs(records, tmp_path / "_stage")
    embeddings = __import__("numpy").zeros((len(chunks), 4), dtype="float32")
    collection = write_collection(
        collection_dir=tmp_path / collection_name("mE5-base", 1),
        chunks=chunks,
        embeddings=embeddings,
        paragraphs_path=paragraphs_path,
        stand_date="2026-07-23",
        embedder_name="intfloat/multilingual-e5-base",
        gloss_model="test-model",
        laws=["BGB"],
    )
    manifest = json.loads((collection / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    assert manifest["embedder"] == "intfloat/multilingual-e5-base"
    assert manifest["stand_date"] == "2026-07-23"
    assert manifest["chunk_count"] == len(chunks)
    assert manifest["gloss_model"] == "test-model"
    assert manifest["laws"] == ["BGB"]
    assert manifest["corpus_hash"]
    assert (collection / "embeddings.npy").exists()
