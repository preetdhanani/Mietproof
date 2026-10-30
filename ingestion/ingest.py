"""Ingestion orchestrator: fetch -> parse -> gloss -> chunk -> embed -> index.

Idempotent: re-running with identical inputs rewrites the same collection.
Cutover and rollback are configuration changes to ``ACTIVE_COLLECTION``.
The gloss pass (one LLM call per paragraph) is skipped entirely when the
generator endpoint is not configured - collections built without glosses
carry an empty ``gloss_en`` and are marked ``gloss_model: null``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SNAPSHOT_ROOT = REPO_ROOT / "corpus" / "snapshots"
DEFAULT_COLLECTIONS_DIR = REPO_ROOT / "data" / "collections"


def build_collection(
    snapshot_path: Path,
    collections_dir: Path,
    embedder_name: str,
    gloss_complete_fn=None,
    gloss_model: str | None = None,
    collection_version: int | None = None,
) -> Path:
    """Build a versioned collection from a committed snapshot.

    ``gloss_complete_fn(system, user) -> str`` performs one LLM call; when
    None the gloss pass is skipped. Returns the collection directory.
    """
    # Local imports keep module import cheap and avoid the heavy
    # sentence-transformers import when only parsing is needed.
    from ingestion.chunk import chunk_paragraphs
    from ingestion.embed import (
        Embedder,
        collection_name,
        embedder_id,
        next_collection_version,
        write_collection,
    )
    from ingestion.gloss import generate_glosses
    from ingestion.parse import parse_bgb_xml, write_paragraphs

    xml_bytes = snapshot_path.read_bytes()
    paragraphs = parse_bgb_xml(xml_bytes)
    stand_date = snapshot_path.parent.name

    glosses: dict[str, str] = {}
    effective_gloss_model = gloss_model
    if gloss_complete_fn is not None:
        glosses, _calls = generate_glosses(
            paragraphs, snapshot_path.parent, gloss_complete_fn, gloss_model or "unknown"
        )
    else:
        effective_gloss_model = None

    chunks = chunk_paragraphs(paragraphs, glosses, stand_date)
    paragraphs_path = write_paragraphs(paragraphs, collections_dir / "_staging")

    embedder = Embedder(embedder_name)
    embeddings = embedder.encode_passages([c.chunk_text for c in chunks])

    embedder_short = embedder_id(embedder_name)
    version = (
        collection_version
        if collection_version is not None
        else next_collection_version(collections_dir, embedder_short)
    )
    collection_dir = collections_dir / collection_name(embedder_short, version)
    write_collection(
        collection_dir=collection_dir,
        chunks=chunks,
        embeddings=embeddings,
        paragraphs_path=paragraphs_path,
        stand_date=stand_date,
        embedder_name=embedder_name,
        gloss_model=effective_gloss_model,
        laws=["BGB"],
    )
    return collection_dir


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--no-gloss",
        action="store_true",
        help="Skip the LLM gloss pass (empty gloss_en in metadata)",
    )
    parser.add_argument(
        "--collections-dir",
        type=Path,
        default=DEFAULT_COLLECTIONS_DIR,
        help="Where versioned collections are written",
    )
    args = parser.parse_args(argv)

    from app.config import get_settings

    settings = get_settings()

    if not settings.CORPUS_STAND:
        print(
            "CORPUS_STAND is unset - set it in .env to the snapshot Stand date "
            f"to ingest. Available snapshots: "
            f"{_list_snapshots(SNAPSHOT_ROOT) or '(none - run with a fetch first)'}",
            file=sys.stderr,
        )
        return 2
    snapshot_path = SNAPSHOT_ROOT / settings.CORPUS_STAND / "bgb.xml"
    if not snapshot_path.exists():
        available = _list_snapshots(SNAPSHOT_ROOT)
        print(
            f"Snapshot for CORPUS_STAND={settings.CORPUS_STAND} does not exist at "
            f"{snapshot_path}. Available snapshots: {available or '(none)'}",
            file=sys.stderr,
        )
        return 2

    gloss_fn = None
    gloss_model = None
    if not args.no_gloss and settings.llm_configured:
        from app.llm import make_completion

        gloss_fn = make_completion(settings.generator)
        gloss_model = settings.generator.model

    collection_dir = build_collection(
        snapshot_path=snapshot_path,
        collections_dir=args.collections_dir,
        embedder_name=settings.EMBEDDING_MODEL,
        gloss_complete_fn=gloss_fn,
        gloss_model=gloss_model,
    )
    print(f"Built collection: {collection_dir}")
    print(f"Set ACTIVE_COLLECTION={collection_dir.name} to serve it.")
    return 0


def _list_snapshots(snapshot_root: Path) -> list[str]:
    from ingestion.fetch import snapshot_stand_dates

    return snapshot_stand_dates(snapshot_root)


if __name__ == "__main__":
    sys.exit(main())
