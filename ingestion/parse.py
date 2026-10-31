"""Parse the BGB statute XML into paragraph records for the rental-law range.

Applies the rental-law range filter (§§ 535-580a) and parses each <norm>
into a paragraph record: number, heading, full text, and the list of Absatz
(subsections) with their text. Writes the records as ``paragraphs.jsonl``
(number, heading, full text, Absatz list) into the collection directory.
This paragraph-level form is the source of truth for citation verification.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree

# Inclusive rental-law range: Mietverhältnisse über Grundstücke etc.
# § 581 starts the Pachtvertrag, so the range ends at § 580a.
RENTAL_RANGE_START = 535
RENTAL_RANGE_END = 580
RENTAL_RANGE_SUFFIX = "a"  # the range's last paragraph is § 580a

LAW_ABBR = "BGB"
LAW_TITLE = "Bürgerliches Gesetzbuch"

# gesetze-im-internet.de deep link for a single paragraph (§).
DEEP_LINK_TEMPLATE = "https://www.gesetze-im-internet.de/bgb/__{para}.html"


@dataclass
class Absatz:
    number: str  # "1", "1a", "2", ...
    text: str


@dataclass
class ParagraphRecord:
    number: str  # "535", "580a", ...
    heading: str
    full_text: str
    absaetze: list[Absatz] = field(default_factory=list)

    def deep_link(self) -> str:
        return DEEP_LINK_TEMPLATE.format(para=self.number)

    def to_json(self) -> dict:
        return {
            "law_abbr": LAW_ABBR,
            "number": self.number,
            "heading": self.heading,
            "full_text": self.full_text,
            "absaetze": [{"number": a.number, "text": a.text} for a in self.absaetze],
            "deep_link": self.deep_link(),
        }


def _clean_text(raw: str) -> str:
    """Normalize extracted element text: collapse whitespace, drop artifacts."""
    text = raw.replace("\xa0", " ")  # non-breaking spaces (e.g. "10 000 Euro")
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _norm_in_range(enbez: str) -> bool:
    match = re.fullmatch(r"§ (\d+)([a-z]?)", enbez.strip())
    if match is None:
        return False
    number, suffix = int(match.group(1)), match.group(2)
    if RENTAL_RANGE_START <= number < RENTAL_RANGE_END:
        return True
    if number == RENTAL_RANGE_END:
        # § 580 itself is in range; § 580b and beyond are not.
        return suffix in ("", RENTAL_RANGE_SUFFIX)
    return False


def _absatz_number(text: str) -> str | None:
    match = re.match(r"\((\d+[a-z]?)\)", text)
    return match.group(1) if match else None


def _strip_absatz_marker(text: str) -> str:
    return re.sub(r"^\(\d+[a-z]?\)\s*", "", text)


def parse_bgb_xml(xml_bytes: bytes) -> list[ParagraphRecord]:
    """Parse the BGB XML into paragraph records for §§ 535-580a."""
    root = ElementTree.fromstring(xml_bytes)
    records: list[ParagraphRecord] = []
    seen: set[str] = set()

    for norm in root.iter("norm"):
        enbez = norm.findtext("./metadaten/enbez")
        if enbez is None or not _norm_in_range(enbez):
            continue
        number = enbez.strip().removeprefix("§ ").strip()
        if number in seen:
            msg = f"Duplicate paragraph § {number} in BGB XML"
            raise ValueError(msg)
        seen.add(number)

        heading = norm.findtext("./metadaten/titel") or ""
        content = norm.find("./textdaten/text/Content")
        if content is None:
            msg = f"§ {number} has no text content"
            raise ValueError(msg)

        absaetze: list[Absatz] = []
        unnumbered_parts: list[str] = []
        for para in content.findall("P"):
            text = _clean_text("".join(para.itertext()))
            if not text:
                continue
            if re.fullmatch(r"\(\+\+\+.*\+\+\)", text):
                continue  # editorial footnote leaked into the main content
            absatz_number = _absatz_number(text)
            if absatz_number is None:
                # Paragraphs without Absatz markers (single-sentence §§):
                # keep the text, it belongs to the paragraph as a whole.
                unnumbered_parts.append(text)
                continue
            absaetze.append(Absatz(number=absatz_number, text=_strip_absatz_marker(text)))

        full_text = " ".join(a.text for a in absaetze + [Absatz("", "")] if a.text)
        if unnumbered_parts:
            unnumbered = " ".join(unnumbered_parts)
            full_text = f"{unnumbered} {full_text}".strip() if full_text else unnumbered
        if not full_text:
            msg = f"§ {number} parsed to empty text"
            raise ValueError(msg)

        records.append(
            ParagraphRecord(
                number=number,
                heading=_clean_text(heading),
                full_text=full_text,
                absaetze=absaetze,
            )
        )

    if not records:
        msg = "No rental-law paragraphs (§§ 535-580a) found in BGB XML"
        raise ValueError(msg)
    return records


def write_paragraphs(
    records: list[ParagraphRecord],
    collection_dir: Path,
    glosses: dict[str, str] | None = None,
) -> Path:
    """Write paragraph records as paragraphs.jsonl into the collection dir.

    ``glosses`` (paragraph number -> English gloss) is merged into the
    records so the paragraph-level retrieval space can embed the gloss -
    the cross-lingual bridge for English queries.
    """
    collection_dir.mkdir(parents=True, exist_ok=True)
    path = collection_dir / "paragraphs.jsonl"
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            data = record.to_json()
            if glosses and record.number in glosses:
                data["gloss_en"] = glosses[record.number]
            handle.write(json.dumps(data, ensure_ascii=False) + "\n")
    return path
