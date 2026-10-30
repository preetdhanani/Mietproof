"""Retriever construction from settings - the one place that maps
``RETRIEVAL_BACKEND`` to an implementation."""

from __future__ import annotations

from pathlib import Path

from app.config import Settings, get_settings
from retrieval.base import Retriever


def build_retriever(
    collection_dir: Path,
    settings: Settings | None = None,
    **backend_kwargs,
) -> Retriever:
    settings = settings or get_settings()
    backend = settings.RETRIEVAL_BACKEND
    if backend == "bm25":
        from retrieval.bm25 import BM25Retriever

        return BM25Retriever(collection_dir, **backend_kwargs)
    if backend == "dense":
        from retrieval.dense import DenseRetriever

        return DenseRetriever(collection_dir, **backend_kwargs)
    if backend == "hybrid":
        from retrieval.hybrid import HybridRetriever

        return HybridRetriever(collection_dir, **backend_kwargs)
    msg = f"Unknown RETRIEVAL_BACKEND: {backend!r}"
    raise ValueError(msg)
