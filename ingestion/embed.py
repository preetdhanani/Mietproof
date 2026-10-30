"""Embedding and collection writing for the dense retrieval backend.

Embeds chunk text with a local multilingual sentence-transformer (no
embedding API calls - the embedding path stays off the shared LLM quota) and
writes the versioned collection directory ``bgb__<embedder-id>__v<N>`` with
embeddings, chunks, paragraphs, and the manifest.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import numpy as np

from ingestion.chunk import Chunk

# Model name -> short id used in collection names (bgb__<embedder-id>__v<N>)
EMBEDDER_IDS = {
    "intfloat/multilingual-e5-base": "mE5-base",
    "BAAI/bge-m3": "bge-m3",
}

MANIFEST_FILENAME = "manifest.json"
EMBEDDINGS_FILENAME = "embeddings.npy"
CHUNKS_FILENAME = "chunks.jsonl"
PARAGRAPHS_FILENAME = "paragraphs.jsonl"


def embedder_id(model_name: str) -> str:
    if model_name in EMBEDDER_IDS:
        return EMBEDDER_IDS[model_name]
    return re.sub(r"[^A-Za-z0-9]+", "-", model_name).strip("-").lower()[:24]


def e5_prefix(text: str, is_query: bool) -> str:
    """multilingual-e5 models require query/passage prefixes."""
    return ("query: " if is_query else "passage: ") + text


class Embedder:
    """Local sentence-transformer embedder with an e5-style prefix hook."""

    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer

        self.model_name = model_name
        self._model = SentenceTransformer(model_name)

    def encode_passages(self, texts: list[str]) -> np.ndarray:
        prefixed = [e5_prefix(t, is_query=False) for t in texts]
        return self._model.encode(prefixed, normalize_embeddings=True, show_progress_bar=False)

    def encode_query(self, text: str) -> np.ndarray:
        return self._model.encode([e5_prefix(text, is_query=True)], normalize_embeddings=True)[0]


def corpus_hash(paragraphs_path: Path) -> str:
    """Hash of the paragraph records - pins the manifest to the exact corpus."""
    return hashlib.sha256(paragraphs_path.read_bytes()).hexdigest()[:16]


def next_collection_version(collections_root: Path, embedder: str) -> int:
    """Next version number for ``bgb__<embedder>__v<N>`` under collections_root."""
    prefix = f"bgb__{embedder}__v"
    versions = [0]
    if collections_root.exists():
        for entry in collections_root.iterdir():
            if entry.is_dir() and entry.name.startswith(prefix):
                suffix = entry.name.removeprefix(prefix)
                if suffix.isdigit():
                    versions.append(int(suffix))
    return max(versions) + 1


def collection_name(embedder: str, version: int) -> str:
    return f"bgb__{embedder}__v{version}"


def write_collection(
    collection_dir: Path,
    chunks: list[Chunk],
    embeddings: np.ndarray,
    paragraphs_path: Path,
    stand_date: str,
    embedder_name: str,
    gloss_model: str,
    laws: list[str],
) -> Path:
    """Write embeddings, chunks, paragraphs, and manifest into the collection."""
    collection_dir.mkdir(parents=True, exist_ok=True)
    np.save(collection_dir / EMBEDDINGS_FILENAME, embeddings)
    with (collection_dir / CHUNKS_FILENAME).open("w", encoding="utf-8") as handle:
        for chunk in chunks:
            handle.write(json.dumps(chunk.to_json(), ensure_ascii=False) + "\n")
    (collection_dir / PARAGRAPHS_FILENAME).write_bytes(paragraphs_path.read_bytes())

    manifest = {
        "collection": collection_dir.name,
        "embedder": embedder_name,
        "corpus_hash": corpus_hash(paragraphs_path),
        "stand_date": stand_date,
        "chunk_count": len(chunks),
        "gloss_model": gloss_model,
        "laws": laws,
    }
    (collection_dir / MANIFEST_FILENAME).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return collection_dir
