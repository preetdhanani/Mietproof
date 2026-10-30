"""Fetch the BGB XML from gesetze-im-internet.de into a pinned snapshot.

Downloads the official XML feed and commits it as
``corpus/snapshots/<stand-date>/bgb.xml``, keyed by the law's published Stand
date (extracted from the amendment comment in the XML). Snapshot pinning is
what makes CI evals reproducible: CI checks out the repo and builds its
throwaway index from the committed snapshot - no network dependency, no
live-VM coupling.
"""

from __future__ import annotations

import re
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree

import httpx

BGB_XML_URL = "https://www.gesetze-im-internet.de/bgb/xml.zip"

# The XML carries the Stand date only inside the amendment comment, e.g.
# "zuletzt geändert durch Art. 6 G v. 23.7.2026 I Nr. 226". We take the last
# amendment date as the Stand date, normalized to ISO YYYY-MM-DD.
_STAND_PATTERN = re.compile(
    r"<standtyp>Stand</standtyp>\s*<standkommentar>([^<]*)</standkommentar>"
)
_DATE_PATTERN = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")


def extract_stand_date(xml_bytes: bytes) -> str:
    """Extract the Stand date from the BGB XML as an ISO date string."""
    root = ElementTree.fromstring(xml_bytes)
    match = _STAND_PATTERN.search(ElementTree.tostring(root, encoding="unicode"))
    if match is None:
        msg = "No <standtyp>Stand</standtyp> entry found in BGB XML"
        raise ValueError(msg)
    date_match = _DATE_PATTERN.search(match.group(1))
    if date_match is None:
        msg = f"No date found in Stand comment: {match.group(1)!r}"
        raise ValueError(msg)
    day, month, year = date_match.groups()
    return f"{year}-{int(month):02d}-{int(day):02d}"


def fetch_bgb_xml(
    snapshot_root: Path, url: str = BGB_XML_URL, client: httpx.Client | None = None
) -> Path:
    """Download the BGB XML and write it to corpus/snapshots/<stand-date>/bgb.xml.

    Returns the snapshot path. If the snapshot for this Stand date already
    exists, the download is skipped (snapshots are immutable once committed).
    """
    owns_client = client is None
    client = client or httpx.Client(timeout=120, follow_redirects=True)
    try:
        response = client.get(url)
        response.raise_for_status()
        xml_bytes = _extract_bgb_xml(response.content)
    finally:
        if owns_client:
            client.close()

    stand_date = extract_stand_date(xml_bytes)
    snapshot_dir = snapshot_root / stand_date
    snapshot_path = snapshot_dir / "bgb.xml"
    if snapshot_path.exists():
        existing = snapshot_path.read_bytes()
        if existing != xml_bytes:
            msg = (
                f"Snapshot {stand_date} exists with different content; "
                "snapshots are immutable - investigate before overwriting"
            )
            raise ValueError(msg)
        return snapshot_path

    snapshot_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_bytes(xml_bytes)
    return snapshot_path


def _extract_bgb_xml(zip_bytes: bytes) -> bytes:
    """Pull the BGB law XML out of the downloaded zip archive."""
    archive = zipfile.ZipFile(BytesIO(zip_bytes))
    xml_names = [name for name in archive.namelist() if name.endswith(".xml")]
    if not xml_names:
        msg = "No .xml file found in the BGB zip archive"
        raise ValueError(msg)
    if len(xml_names) > 1:
        msg = f"Expected one XML in the BGB zip, found: {xml_names}"
        raise ValueError(msg)
    return archive.read(xml_names[0])


def snapshot_stand_dates(snapshot_root: Path) -> list[str]:
    """List available snapshot Stand dates, newest first."""
    if not snapshot_root.exists():
        return []
    dates = []
    for entry in snapshot_root.iterdir():
        if entry.is_dir() and _ISO_DATE.match(entry.name):
            dates.append(entry.name)
    dates.sort(reverse=True)
    return dates


_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def utc_now_iso() -> str:
    """Current UTC time as an ISO string (isolated for testability)."""
    return datetime.now(tz=UTC).isoformat()
