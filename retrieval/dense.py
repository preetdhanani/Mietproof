"""Dense retrieval backend: local multilingual embeddings, cosine ranking.

The embedding model runs on CPU at query time; embeddings are computed at
ingest and cached in the collection. No embedding API calls - the embedding
path stays off the shared LLM quota and survives endpoint expiry.

Confidence: cosine similarity mapped from its native [-1, 1] range to 0-1
via ``(cos + 1) / 2``.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from retrieval.base import (
    EMBEDDINGS_FILENAME,
    ScoredChunk,
    load_chunks,
)


class DenseRetriever:
    def __init__(self, collection_dir: Path, model=None):
        """``model`` injects a pre-loaded sentence-transformer (tests); when
        None the model is loaded lazily from EMBEDDING_MODEL config."""
        self.collection_dir = collection_dir
        self.chunks = load_chunks(collection_dir)
        if not self.chunks:
            msg = f"Collection {collection_dir} has no chunks - index is empty"
            raise ValueError(msg)
        self.embeddings = np.load(collection_dir / EMBEDDINGS_FILENAME)
        if len(self.chunks) != self.embeddings.shape[0]:
            msg = (
                f"Collection {collection_dir} inconsistent: {len(self.chunks)} chunks "
                f"vs {self.embeddings.shape[0]} embeddings"
            )
            raise ValueError(msg)
        self._model = model
        if model is None:
            from app.config import get_settings
            from ingestion.embed import Embedder

            self._model = Embedder(get_settings().EMBEDDING_MODEL)

    def _query_embedding(self, query: str) -> np.ndarray:
        return self._model.encode_query(query)

    def retrieve(self, query: str, k: int = 5) -> list[ScoredChunk]:
        query_vec = self._query_embedding(query)
        # Cosine similarity; embeddings are L2-normalized at ingest and the
        # query vector is normalized in encode_query.
        sims = self.embeddings @ query_vec
        order = np.argsort(-sims)[:k]
        # index is the 1-based rank in this result list - the prompt's [1],
        # [2], ... references are rank-based, not corpus positions.
        return [
            self._scored(rank + 1, int(position), float(sims[position]))
            for rank, position in enumerate(order)
        ]

    def confidence(self, query: str) -> float:
        sims = self.embeddings @ self._query_embedding(query)
        top1 = float(sims.max()) if sims.size else -1.0
        return (top1 + 1.0) / 2.0  # map [-1, 1] -> [0, 1]

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
