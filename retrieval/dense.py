"""Dense retrieval backend: local multilingual embeddings, fused ranking.

Two embedding spaces are built from the collection at startup:

* paragraph space - one vector per § (heading + full text, optionally with
  the English gloss once the gloss pass has run);
* chunk space - one vector per Absatz chunk (the collection's stored
  embeddings, computed at ingest).

Retrieval fuses both: each space is normalized by its own top score and the
per-paragraph maximum of the two is used. This gives Absatz-level precision
while keeping whole-paragraph context retrievable - the cross-lingual
problem (English query, German corpus) otherwise lands colloquial queries
on adjacent paragraphs.

No embedding API calls - the embedding path stays off the shared LLM quota
and survives endpoint expiry.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from retrieval.base import (
    EMBEDDINGS_FILENAME,
    ScoredChunk,
    load_chunks,
    load_paragraphs,
)
from retrieval.enrich import enrich_query


class DenseRetriever:
    def __init__(self, collection_dir: Path, model=None, enrich: bool = True):
        """``model`` injects a pre-loaded embedder (tests); when None the
        model is loaded lazily from EMBEDDING_MODEL config."""
        self.collection_dir = collection_dir
        self.chunks = load_chunks(collection_dir)
        if not self.chunks:
            msg = f"Collection {collection_dir} has no chunks - index is empty"
            raise ValueError(msg)
        self.chunk_embeddings = np.load(collection_dir / EMBEDDINGS_FILENAME)
        if len(self.chunks) != self.chunk_embeddings.shape[0]:
            msg = (
                f"Collection {collection_dir} inconsistent: {len(self.chunks)} chunks "
                f"vs {self.chunk_embeddings.shape[0]} embeddings"
            )
            raise ValueError(msg)
        self.enrich_enabled = enrich
        self._model = model
        if model is None:
            from app.config import get_settings
            from ingestion.embed import Embedder

            self._model = Embedder(get_settings().EMBEDDING_MODEL)

        self._build_paragraph_space()

    def _build_paragraph_space(self) -> None:
        """One embedding per §: heading + full text (+ gloss when present)."""
        self.paragraphs = load_paragraphs(self.collection_dir)
        numbers = sorted(
            self.paragraphs.keys(),
            key=lambda n: (int("".join(filter(str.isdigit, n)) or 0), n),
        )
        self.paragraph_numbers = numbers
        texts = []
        for n in numbers:
            record = self.paragraphs[n]
            text = record["full_text"]
            if record.get("gloss_en"):
                text = record["gloss_en"] + " | " + text
            if record.get("heading"):
                text = record["heading"] + ". " + text
            texts.append(text)
        self.paragraph_embeddings = self._model.encode_passages(texts)
        # Map paragraph number -> row, and chunk index -> paragraph row.
        self._para_row = {n: i for i, n in enumerate(numbers)}
        self._chunk_row = []
        for chunk in self.chunks:
            self._chunk_row.append(self._para_row.get(chunk["paragraph"], -1))

    def _query_embedding(self, query: str) -> np.ndarray:
        effective = enrich_query(query) if self.enrich_enabled else query
        return self._model.encode_query(effective)

    def retrieve(self, query: str, k: int = 5) -> list[ScoredChunk]:
        query_vec = self._query_embedding(query)
        # Cosine similarity in both spaces; embeddings are L2-normalized.
        chunk_sims = self.chunk_embeddings @ query_vec
        para_sims = self.paragraph_embeddings @ query_vec

        # Ranking happens in the PARAGRAPH space (heading + full text + gloss):
        # it is the more robust cross-lingual matcher. The chunk space selects
        # the displayed Absatz within each hit paragraph.
        order = np.argsort(-para_sims)[:k]
        chunk_norm = chunk_sims / (chunk_sims.max() + 1e-9)
        results: list[ScoredChunk] = []
        for rank, para_row in enumerate(order):
            chunk_index = self._best_chunk_index(int(para_row), chunk_norm)
            results.append(self._scored(rank + 1, chunk_index, float(para_sims[para_row])))
        return results

    def _best_chunk_index(self, para_row: int, chunk_norm: np.ndarray) -> int:
        best_index, best_value = -1, -1.0
        for chunk_index, row in enumerate(self._chunk_row):
            if row == para_row and chunk_norm[chunk_index] > best_value:
                best_index, best_value = chunk_index, chunk_norm[chunk_index]
        if best_index < 0:  # paragraph without chunks - synthesize from full text
            return -1
        return best_index

    def confidence(self, query: str) -> float:
        query_vec = self._query_embedding(query)
        chunk_sims = self.chunk_embeddings @ query_vec
        para_sims = self.paragraph_embeddings @ query_vec
        top1 = max(
            float(chunk_sims.max()) if chunk_sims.size else -1.0,
            float(para_sims.max()) if para_sims.size else -1.0,
        )
        return (top1 + 1.0) / 2.0  # map [-1, 1] -> [0, 1]

    def _scored(self, index: int, chunk_index: int, score: float) -> ScoredChunk:
        if chunk_index >= 0:
            payload = self.chunks[chunk_index]
        else:
            number = self.paragraph_numbers[index - 1]
            record = self.paragraphs[number]
            payload = {
                "law_abbr": "BGB",
                "paragraph": number,
                "absatz": "0",
                "stand_date": record.get("stand_date", ""),
                "gloss_en": record.get("gloss_en", ""),
                "chunk_text": record["full_text"][:400],
            }
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
