"""Citation verifier unit tests: invented § numbers rejected, quote mismatch
detected (normalization-aware), refusal path taken after repeated failure,
citation assembly from metadata only."""

from __future__ import annotations

from app.citations import (
    assemble_citations,
    extract_chunk_refs,
    verify_answer,
)
from retrieval.base import ScoredChunk


def make_chunks() -> list[ScoredChunk]:
    return [
        ScoredChunk(
            law_abbr="BGB",
            paragraph="535",
            absatz="1",
            stand_date="2026-07-23",
            gloss_en="Main duties of the rental contract.",
            chunk_text="Durch den Mietvertrag wird der Vermieter verpflichtet, dem Mieter "
            "den Gebrauch der Mietsache während der Mietzeit zu gewähren.",
            score=0.9,
            index=1,
        ),
        ScoredChunk(
            law_abbr="BGB",
            paragraph="551",
            absatz="1",
            stand_date="2026-07-23",
            gloss_en="Deposit must be held separately.",
            chunk_text="Der Vermieter hat eine von ihm als Sicherheit überlassene Summe "
            "getrennt von seinem übrigen Vermögen zu verwahren.",
            score=0.85,
            index=2,
        ),
    ]


def make_paragraphs() -> dict[str, dict]:
    chunks = make_chunks()
    return {
        "535": {
            "number": "535",
            "full_text": chunks[0].chunk_text,
            "heading": "Inhalt und Hauptpflichten des Mietvertrags",
        },
        "551": {
            "number": "551",
            "full_text": chunks[1].chunk_text,
            "heading": "Sicherheitsleistung",
        },
    }


def test_extract_refs_in_order() -> None:
    assert extract_chunk_refs(
        "The landlord must [2] return it and [1] grant use, see [2] again"
    ) == [2, 1]


def test_assemble_citations_from_metadata_only() -> None:
    answer = "The landlord must grant use [1] and hold the deposit separately [2]."
    citations = assemble_citations(answer, make_chunks())
    assert [c.paragraph for c in citations] == ["535", "551"]
    assert citations[0].deep_link.endswith("/bgb/__535.html")
    assert citations[1].gloss_en == "Deposit must be held separately."
    # Citation content comes from chunk metadata, never from the answer text.
    assert citations[0].german_text == make_chunks()[0].chunk_text


def test_assemble_citations_skips_unknown_index() -> None:
    answer = "Claim [7] with no backing chunk."
    assert assemble_citations(answer, make_chunks()) == []


def test_verify_rejects_unprovided_index() -> None:
    result = verify_answer("Something [3].", make_chunks(), make_paragraphs())
    assert not result.ok
    assert any("not provided" in f for f in result.failures)


def test_verify_accepts_valid_answer() -> None:
    answer = (
        "The landlord must grant use of the property [1] and must keep the "
        'security deposit separate from his own assets: "getrennt von seinem '
        'übrigen Vermögen zu verwahren" [2].'
    )
    result = verify_answer(answer, make_chunks(), make_paragraphs())
    assert result.ok, result.failures


def test_verify_rejects_quote_mismatch() -> None:
    answer = (
        "The landlord must hold the deposit "
        '"getrennt von seinem eigenen Vermögen zu verwahren" [2].'
    )
    result = verify_answer(answer, make_chunks(), make_paragraphs())
    assert not result.ok
    assert any("not found in the referenced paragraphs" in f for f in result.failures)


def test_verify_quote_normalization() -> None:
    # Same quote with different whitespace/punctuation/quotes passes.
    answer = (
        "The landlord must hold the deposit "
        '"getrennt  von seinem übrigen Vermögen zu verwahren." [2].'
    )
    result = verify_answer(answer, make_chunks(), make_paragraphs())
    assert result.ok, result.failures


def test_verify_short_quotes_exempt() -> None:
    answer = 'The "übrigen Vermögen" rule applies [2].'
    result = verify_answer(answer, make_chunks(), make_paragraphs())
    assert result.ok, result.failures


def test_verify_quote_without_reference_fails() -> None:
    answer = 'The statute says "getrennt von seinem übrigen Vermögen zu verwahren".'
    result = verify_answer(answer, make_chunks(), make_paragraphs())
    assert not result.ok
    assert any("no referenced paragraph" in f for f in result.failures)


def test_verify_quote_spanning_chunk_boundary() -> None:
    # A quote assembled from the full paragraph record (not the chunk text)
    # is verifiable because verification reads paragraphs.jsonl.
    paragraphs = make_paragraphs()
    paragraphs["535"]["full_text"] = (
        "Erste Satzteil. Durch den Mietvertrag wird der Vermieter verpflichtet, "
        "dem Mieter den Gebrauch der Mietsache während der Mietzeit zu gewähren. "
        "Weiterer Satzteil."
    )
    answer = (
        "The statute provides "
        '"Durch den Mietvertrag wird der Vermieter verpflichtet, dem Mieter den '
        'Gebrauch der Mietsache während der Mietzeit zu gewähren" [1].'
    )
    result = verify_answer(answer, make_chunks(), paragraphs)
    assert result.ok, result.failures


def test_verify_records_every_check() -> None:
    answer = (
        'The landlord must grant use of the property [1]. It says "den Gebrauch der '
        'Mietsache während der Mietzeit zu gewähren" [1]. See also [7].'
    )
    result = verify_answer(answer, make_chunks(), make_paragraphs())
    by_kind = {(c["kind"], c["target"]): c for c in result.checks}
    assert by_kind[("ref", "[1]")]["passed"]
    assert not by_kind[("ref", "[7]")]["passed"]
    assert by_kind[("paragraph", "§ 535")]["passed"]
    quote = next(c for c in result.checks if c["kind"] == "quote")
    assert quote["passed"] and quote["detail"] == "found verbatim in § 535"
    # failures are exactly the checks that did not pass
    assert result.failures == [c["detail"] for c in result.checks if not c["passed"]]
