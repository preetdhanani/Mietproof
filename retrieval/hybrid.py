"""Hybrid retrieval backend: reciprocal-rank fusion of BM25 and dense.

The anticipated winner for mixed English/German queries. Confidence is the
dense side's value (per the design's normalization rule), so the
out-of-scope floor works uniformly across backends.
"""

from __future__ import annotations

from pathlib import Path

from retrieval.base import ScoredChunk
from retrieval.bm25 import BM25Retriever
from retrieval.dense import DenseRetriever

RRF_K = 60  # standard reciprocal-rank-fusion constant

# Tuned on the golden set (see evals/results/retrieval_comparison.md): the
# dense side carries twice the weight because plain BM25 contributes mostly
# noise on cross-lingual (English query, German corpus) queries.
DENSE_WEIGHT = 2.0
BM25_WEIGHT = 1.0


class HybridRetriever:
    def __init__(self, collection_dir: Path, model=None, enrich: bool = True):
        self._bm25 = BM25Retriever(collection_dir)
        self._dense = DenseRetriever(collection_dir, model=model, enrich=enrich)

    def retrieve(self, query: str, k: int = 5) -> list[ScoredChunk]:
        bm25_hits = self._bm25.retrieve(query, k=10)
        dense_hits = self._dense.retrieve(query, k=10)

        # RRF over the two rankings, keyed by (paragraph, absatz) so both
        # backends' views of the same chunk reinforce each other.
        scores: dict[tuple[str, str], float] = {}
        for weight, ranking in ((BM25_WEIGHT, bm25_hits), (DENSE_WEIGHT, dense_hits)):
            for rank, chunk in enumerate(ranking):
                key = (chunk.paragraph, chunk.absatz)
                scores[key] = scores.get(key, 0.0) + weight / (RRF_K + rank + 1)

        order = sorted(scores.items(), key=lambda kv: -kv[1])[:k]
        # Display payload comes from the dense side (it carries the fused
        # paragraph-level view); fall back to BM25's chunks.
        payload_map = {(c.paragraph, c.absatz): c for c in dense_hits + bm25_hits}
        results: list[ScoredChunk] = []
        for rank, (key, _score) in enumerate(order):
            source = payload_map[key]
            results.append(
                ScoredChunk(
                    law_abbr=source.law_abbr,
                    paragraph=key[0],
                    absatz=key[1],
                    stand_date=source.stand_date,
                    gloss_en=source.gloss_en,
                    chunk_text=source.chunk_text,
                    score=scores[key],
                    index=rank + 1,
                )
            )
        return results

    def confidence(self, query: str) -> float:
        # Dense side's value, per the design's normalization rule.
        return self._dense.confidence(query)
