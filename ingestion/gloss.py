"""English gloss generation: one LLM call per paragraph, once per Stand date.

Glosses are cached by paragraph hash in the snapshot directory, so an
unchanged Stand date re-ingests without LLM calls. The gloss generator model
is recorded in the collection manifest.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from ingestion.parse import ParagraphRecord

GLOSS_SYSTEM_PROMPT = (
    "You are a legal translator. For each German statutory paragraph you "
    "receive, write a one- to two-sentence English gloss stating what the "
    "paragraph governs. Do not translate the full text; summarize its legal "
    "effect. Plain English, no jargon, no preamble."
)

GLOSS_CACHE_FILENAME = "glosses.json"


def paragraph_hash(record: ParagraphRecord) -> str:
    """Stable hash of a paragraph's German text - the gloss cache key."""
    payload = f"{record.number}|{record.heading}|{record.full_text}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def load_gloss_cache(snapshot_dir: Path) -> dict[str, dict]:
    """Load the gloss cache from the snapshot directory, if present."""
    path = snapshot_dir / GLOSS_CACHE_FILENAME
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_gloss_cache(snapshot_dir: Path, cache: dict[str, dict]) -> Path:
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    path = snapshot_dir / GLOSS_CACHE_FILENAME
    path.write_text(
        json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True),
        encoding="utf-8",
    )
    return path


def gloss_prompt(record: ParagraphRecord) -> str:
    heading = f" ({record.heading})" if record.heading else ""
    return f"§ {record.number} BGB{heading}:\n{record.full_text}"


def generate_glosses(
    paragraphs: list[ParagraphRecord],
    snapshot_dir: Path,
    complete_fn,
    gloss_model: str,
) -> tuple[dict[str, str], int]:
    """Generate or load English glosses for all paragraphs.

    ``complete_fn(system, user) -> str`` performs one LLM call. Returns
    (glosses by paragraph number, number of LLM calls made). Cached entries
    whose paragraph hash matches are reused unchanged.
    """
    cache = load_gloss_cache(snapshot_dir)
    glosses: dict[str, str] = {}
    calls = 0
    for record in paragraphs:
        text_hash = paragraph_hash(record)
        entry = cache.get(record.number)
        if entry and entry.get("hash") == text_hash and entry.get("gloss"):
            glosses[record.number] = entry["gloss"]
            continue
        gloss = complete_fn(GLOSS_SYSTEM_PROMPT, gloss_prompt(record))
        calls += 1
        glosses[record.number] = gloss
        cache[record.number] = {"hash": text_hash, "gloss": gloss, "model": gloss_model}
    if calls:
        save_gloss_cache(snapshot_dir, cache)
    return glosses, calls
