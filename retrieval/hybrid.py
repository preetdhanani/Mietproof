"""Hybrid retrieval backend: reciprocal-rank fusion of BM25 and dense.

The anticipated winner for mixed English/German queries. Confidence is the
dense side's value (per the design's normalization rule), so the
out-of-scope floor works uniformly across backends.
"""

from __future__ import annotations

import time
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
        return self._fuse(bm25_hits, dense_hits, k)[0]

    def confidence(self, query: str) -> float:
        # Dense side's value, per the design's normalization rule.
        return self._dense.confidence(query)

    def retrieve_debug(self, query: str, k: int = 5) -> tuple[list[ScoredChunk], dict]:
        """Like retrieve(), but returns both arms, the fusion math, and how
        long each arm took, for the debug UI. Runs retrieval exactly once."""
        started = time.perf_counter()
        bm25_hits, bm25_detail = self._bm25.retrieve_debug(query, k=10)
        after_bm25 = time.perf_counter()
        dense_hits, dense_detail = self._dense.retrieve_debug(query, k=10)
        after_dense = time.perf_counter()
        results, fusion_rows = self._fuse(bm25_hits, dense_hits, k)
        after_fusion = time.perf_counter()
        return results, {
            "bm25_top10": [
                {
                    "rank": c.index,
                    "paragraph": c.paragraph,
                    "absatz": c.absatz,
                    "score": round(c.score, 3),
                    "text": c.chunk_text,
                    **explanation,
                }
                for c, explanation in zip(bm25_hits, bm25_detail.pop("explanations"), strict=True)
            ],
            "bm25_detail": bm25_detail,
            "dense_top10": [
                {"paragraph": c.paragraph, "absatz": c.absatz, "score": round(c.score, 4)}
                for c in dense_hits
            ],
            "confidence": dense_detail.pop("confidence"),
            "dense_per_paragraph": dense_detail,
            "fusion": fusion_rows,
            "weights": {"bm25": BM25_WEIGHT, "dense": DENSE_WEIGHT, "rrf_k": RRF_K},
            "timings_ms": {
                "bm25": round((after_bm25 - started) * 1000, 1),
                "dense": round((after_dense - after_bm25) * 1000, 1),
                "fusion": round((after_fusion - after_dense) * 1000, 1),
            },
        }

    def _fuse(
        self, bm25_hits: list[ScoredChunk], dense_hits: list[ScoredChunk], k: int
    ) -> tuple[list[ScoredChunk], list[dict]]:
        """RRF over the two rankings, keyed by (paragraph, absatz) so both
        backends' views of the same chunk reinforce each other."""
        scores: dict[tuple[str, str], float] = {}
        contributions: dict[tuple[str, str], dict] = {}
        for weight, name, ranking in (
            (BM25_WEIGHT, "bm25", bm25_hits),
            (DENSE_WEIGHT, "dense", dense_hits),
        ):
            for rank, chunk in enumerate(ranking):
                key = (chunk.paragraph, chunk.absatz)
                contribution = weight / (RRF_K + rank + 1)
                scores[key] = scores.get(key, 0.0) + contribution
                contributions.setdefault(key, {})[name] = {
                    "rank": rank + 1,
                    "contribution": round(contribution, 6),
                }

        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        order = ranked[:k]
        # Display payload comes from the dense side (it carries the fused
        # paragraph-level view); fall back to BM25's chunks.
        payload_map = {(c.paragraph, c.absatz): c for c in dense_hits + bm25_hits}
        results: list[ScoredChunk] = []
        for rank, (key, total) in enumerate(order):
            source = payload_map[key]
            results.append(
                ScoredChunk(
                    law_abbr=source.law_abbr,
                    paragraph=key[0],
                    absatz=key[1],
                    stand_date=source.stand_date,
                    gloss_en=source.gloss_en,
                    chunk_text=source.chunk_text,
                    score=total,
                    index=rank + 1,
                )
            )
        # Every candidate either arm returned, so the UI can show what fusion dropped.
        rows = [
            {
                "rank": rank + 1,
                "paragraph": key[0],
                "absatz": key[1],
                "rrf_score": round(total, 6),
                "arms": contributions.get(key, {}),
                "selected": rank < k,
            }
            for rank, (key, total) in enumerate(ranked)
        ]
        return results, rows
