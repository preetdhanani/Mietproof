"""Chunk paragraphs along Absatz boundaries with a token-size cap.

Every chunk carries the full payload metadata: ``law_abbr``, ``paragraph``,
``absatz``, ``stand_date``, ``gloss_en``, ``chunk_text``. Metadata
completeness is asserted at ingest time - citation assembly depends on it.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from ingestion.parse import ParagraphRecord

# A chunk holds one Absatz unless the Absatz exceeds this many words, in
# which case it is split along sentence boundaries with a small overlap.
MAX_CHUNK_WORDS = 220
OVERLAP_WORDS = 30

CHUNK_REQUIRED_FIELDS = (
    "law_abbr",
    "paragraph",
    "absatz",
    "stand_date",
    "gloss_en",
    "chunk_text",
)


@dataclass
class Chunk:
    law_abbr: str
    paragraph: str
    absatz: str
    stand_date: str
    gloss_en: str
    chunk_text: str

    def to_json(self) -> dict:
        return {
            "law_abbr": self.law_abbr,
            "paragraph": self.paragraph,
            "absatz": self.absatz,
            "stand_date": self.stand_date,
            "gloss_en": self.gloss_en,
            "chunk_text": self.chunk_text,
        }


def _split_long_text(text: str, max_words: int, overlap: int) -> list[str]:
    """Split a long Absatz along sentence boundaries with overlap."""
    sentences = re.findall(r"[^.!?]+[.!?]+[\"')\]]*\s*", text)
    sentences = [s.strip() for s in sentences if s.strip()]
    if not sentences:  # no sentence terminators - one oversized chunk
        return [text]

    chunks: list[str] = []
    current: list[str] = []
    current_words = 0
    for sentence in sentences:
        words = sentence.split()
        if current and current_words + len(words) > max_words:
            chunks.append(" ".join(current))
            tail = " ".join(current[-overlap:]) if overlap else ""
            current = ([tail] if tail else []) + [sentence]
            current_words = len(tail.split()) + len(words)
        else:
            current.append(sentence)
            current_words += len(words)
    if current:
        chunks.append(" ".join(current))
    return chunks


def chunk_paragraphs(
    paragraphs: list[ParagraphRecord],
    glosses: dict[str, str],
    stand_date: str,
    law_abbr: str = "BGB",
) -> list[Chunk]:
    """Chunk paragraph records along Absatz boundaries.

    ``glosses`` maps paragraph number -> English gloss (generated once per
    Stand date by the ingest-time gloss pass; empty string when the gloss
    pass is skipped, e.g. in tests).
    """
    chunks: list[Chunk] = []
    for paragraph in paragraphs:
        gloss = glosses.get(paragraph.number, "")
        if paragraph.absaetze:
            parts = [(a.number, a.text) for a in paragraph.absaetze]
        else:
            parts = [("", paragraph.full_text)]
        for absatz_number, absatz_text in parts:
            for piece in _split_long_text(absatz_text, MAX_CHUNK_WORDS, OVERLAP_WORDS):
                chunks.append(
                    Chunk(
                        law_abbr=law_abbr,
                        paragraph=paragraph.number,
                        absatz=absatz_number or "0",  # "0" = paragraph without Absatz markers
                        stand_date=stand_date,
                        gloss_en=gloss,
                        chunk_text=piece,
                    )
                )
    return chunks


def assert_chunk_metadata(chunks: list[Chunk]) -> None:
    """Assert payload metadata completeness - citation assembly depends on it."""
    for chunk in chunks:
        data = chunk.to_json()
        missing = [field for field in CHUNK_REQUIRED_FIELDS if not str(data.get(field, "")).strip()]
        # gloss_en may legitimately be empty only when the gloss pass was
        # skipped; chunk_text, paragraph and stand_date must always be set.
        hard_missing = [f for f in missing if f != "gloss_en"]
        if hard_missing:
            msg = f"Chunk for § {chunk.paragraph} missing metadata: {hard_missing}"
            raise ValueError(msg)


def write_chunks(chunks: list[Chunk], collection_dir: Path) -> Path:
    """Write chunks as chunks.jsonl into the collection dir."""
    assert_chunk_metadata(chunks)
    collection_dir.mkdir(parents=True, exist_ok=True)
    path = collection_dir / "chunks.jsonl"
    with path.open("w", encoding="utf-8") as handle:
        for chunk in chunks:
            handle.write(json.dumps(chunk.to_json(), ensure_ascii=False) + "\n")
    return path
