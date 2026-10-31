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

_TOKEN_PATTERN = re.compile(r"[a-z0-9ß]+")


def tokenize(text: str) -> list[str]:
    """Lowercase, strip accents, tokenize on letters/digits."""
    # NFKD splits "ü" into "u" + a combining mark; dropping the marks keeps
    # the word whole ("kündigung" -> "kundigung", not "ku" + "ndigung").
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
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
        return self.retrieve_debug(query, k)[0]

    def retrieve_debug(self, query: str, k: int = 5) -> tuple[list[ScoredChunk], dict]:
        """Ranked hits plus the scoring explained for the debug UI: the query
        tokens, each hit's per-term contribution (they sum to its score), the
        BM25 parameters, and the score of every chunk in the index."""
        tokens = tokenize(query)
        scores = self._bm25.get_scores(tokens)
        order = sorted(range(len(scores)), key=lambda i: -scores[i])[:k]
        hits = [
            self._scored(rank + 1, position, float(scores[position]))
            for rank, position in enumerate(order)
        ]
        bm25 = self._bm25
        detail = {
            "query_tokens": tokens,
            "params": {
                "k1": bm25.k1,
                "b": bm25.b,
                "avgdl": round(bm25.avgdl, 1),
                "n_chunks": bm25.corpus_size,
            },
            "idf": {t: round(bm25.idf.get(t) or 0.0, 3) for t in dict.fromkeys(tokens)},
            "explanations": [self._explain(tokens, position) for position in order],
            "all_scores": [round(float(x), 3) for x in scores],
            "matched_chunks": int((scores > 0).sum()),
        }
        return hits, detail

    def _explain(self, tokens: list[str], position: int) -> dict:
        """Per-term BM25 contributions for one chunk, mirroring
        BM25Okapi.get_scores (repeated query tokens count once per repeat)."""
        bm25 = self._bm25
        doc_len = bm25.doc_len[position]
        norm = bm25.k1 * (1 - bm25.b + bm25.b * doc_len / bm25.avgdl)
        terms: dict[str, dict] = {}
        for token in tokens:
            tf = bm25.doc_freqs[position].get(token) or 0
            contribution = (bm25.idf.get(token) or 0) * (tf * (bm25.k1 + 1) / (tf + norm))
            entry = terms.setdefault(token, {"term": token, "tf": tf, "contribution": 0.0})
            entry["contribution"] += contribution
        return {
            "doc_len": doc_len,
            "terms": [
                {**t, "contribution": round(t["contribution"], 3)}
                for t in terms.values()
                if t["tf"] > 0
            ],
        }

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
