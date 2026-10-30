"""BM25 retrieval backend: lexical scoring over chunk text.

Expected to lose on cross-lingual queries - that loss, measured, is part of
the published comparison table.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from rank_bm25 import BM25Okapi

from retrieval.base import (
    ScoredChunk,
    load_chunks,
)

# BM25 confidence normalization: score / max score observed over the
# golden-set query population, fixed at calibration time. The constant
# below is the observed maximum raw BM25 score over the calibration
# population; re-derive it with retrieval/compare.py when the corpus or
# tokenizer changes.
BM25_CONFIDENCE_MAX = 20.0

_TOKEN_PATTERN = re.compile(r"[a-z0-9äöüß]+")


def tokenize(text: str) -> list[str]:
    """Lowercase, strip accents, tokenize on letters/digits."""
    text = unicodedata.normalize("NFKD", text.lower())
    return _TOKEN_PATTERN.findall(text)


class BM25Retriever:
    def __init__(self, collection_dir: Path):
        self.collection_dir = collection_dir
        self.chunks = load_chunks(collection_dir)
        if not self.chunks:
            msg = f"Collection {collection_dir} has no chunks - index is empty"
            raise ValueError(msg)
        corpus = [tokenize(c["chunk_text"]) for c in self.chunks]
        self._bm25 = BM25Okapi(corpus)

    def retrieve(self, query: str, k: int = 5) -> list[ScoredChunk]:
        scores = self._bm25.get_scores(tokenize(query))
        order = sorted(range(len(scores)), key=lambda i: -scores[i])[:k]
        return [
            self._scored(rank + 1, position, float(scores[position]))
            for rank, position in enumerate(order)
        ]

    def confidence(self, query: str) -> float:
        scores = self._bm25.get_scores(tokenize(query))
        top1 = float(scores.max()) if len(scores) else 0.0
        return max(0.0, min(1.0, top1 / BM25_CONFIDENCE_MAX))

    def _scored(self, index: int, position: int, score: float) -> ScoredChunk:
        payload = self.chunks[position]
        return ScoredChunk(
            law_abbr=payload["law_abbr"],
            paragraph=payload["paragraph"],
            absatz=payload["absatz"],
            stand_date=payload["stand_date"],
            gloss_en=payload["gloss_en"],
            chunk_text=payload["chunk_text"],
            score=score,
            index=index,
        )
