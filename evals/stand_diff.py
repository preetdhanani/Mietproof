"""Stand-date drift check: flags golden items whose verification Stand
differs from the pinned snapshot's Stand date. No text diffing - the flagged
list is the re-verification queue. Wired into CI so the gate refuses to go
green when the corpus has moved under golden items.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from evals.deterministic import GOLDEN_SET_PATH, load_golden_set  # noqa: E402
from ingestion.fetch import snapshot_stand_dates  # noqa: E402

SNAPSHOT_ROOT = REPO_ROOT / "corpus" / "snapshots"


def pinned_stand(settings=None) -> str | None:
    """The CORPUS_STAND pin (settings), else the newest committed snapshot."""
    if settings is None:
        from app.config import get_settings

        settings = get_settings()
    if settings.CORPUS_STAND:
        return settings.CORPUS_STAND
    dates = snapshot_stand_dates(SNAPSHOT_ROOT)
    return dates[0] if dates else None


def run_stand_diff() -> list[str]:
    """Return the golden items needing re-verification (empty = clean)."""
    pinned = pinned_stand()
    if not pinned:
        print("No committed snapshot found - nothing to diff against", file=sys.stderr)
        return []
    flagged = []
    for item in load_golden_set(GOLDEN_SET_PATH):
        if item.get("verified_against_stand") != pinned:
            flagged.append(
                f"{item['id']}: verified against {item.get('verified_against_stand')}, "
                f"pinned snapshot is {pinned}"
            )
    return flagged


def main() -> int:
    flagged = run_stand_diff()
    if flagged:
        print(f"Stand-diff: {len(flagged)} golden item(s) need re-verification:")
        for entry in flagged:
            print(f"  - {entry}")
        return 1
    print("Stand-diff: all golden items verified against the pinned snapshot.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
