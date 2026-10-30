"""Retriever protocol and the shared chunk record.

A ``Retriever`` exposes ``retrieve(query, k)`` -> ranked chunks with
metadata and scores, plus ``confidence(query)`` -> a normalized 0-1 score
for the out-of-scope floor. This is the one abstraction the design
justifies: the comparison experiment requires a uniform interface across
the three retrieval backends, and the shipped default is selected by eval.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

MANIFEST_FILENAME = "manifest.json"
CHUNKS_FILENAME = "chunks.jsonl"
PARAGRAPHS_FILENAME = "paragraphs.jsonl"
EMBEDDINGS_FILENAME = "embeddings.npy"


@dataclass
class ScoredChunk:
    """One retrieved chunk with its metadata and retrieval score."""

    law_abbr: str
    paragraph: str
    absatz: str
    stand_date: str
    gloss_en: str
    chunk_text: str
    score: float
    index: int  # 1-based position in the ranked list, for [1]-style references

    def to_json(self) -> dict:
        return {
            "law_abbr": self.law_abbr,
            "paragraph": self.paragraph,
            "absatz": self.absatz,
            "stand_date": self.stand_date,
            "gloss_en": self.gloss_en,
            "chunk_text": self.chunk_text,
            "score": self.score,
            "index": self.index,
        }


@runtime_checkable
class Retriever(Protocol):
    def retrieve(self, query: str, k: int = 5) -> list[ScoredChunk]:
        """Return the top-k chunks ranked by relevance."""
        ...

    def confidence(self, query: str) -> float:
        """Normalized 0-1 score of the top-1 hit for the out-of-scope floor."""
        ...


def load_chunks(collection_dir: Path) -> list[dict]:
    """Load chunk payload dicts from the collection."""
    path = collection_dir / CHUNKS_FILENAME
    chunks = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                chunks.append(json.loads(line))
    return chunks


def load_manifest(collection_dir: Path) -> dict:
    path = collection_dir / MANIFEST_FILENAME
    return json.loads(path.read_text(encoding="utf-8"))


def load_paragraphs(collection_dir: Path) -> dict[str, dict]:
    """Load paragraph records keyed by paragraph number."""
    path = collection_dir / PARAGRAPHS_FILENAME
    paragraphs = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                record = json.loads(line)
                paragraphs[record["number"]] = record
    return paragraphs
