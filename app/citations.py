"""Citation assembly and deterministic verification.

Citations are assembled exclusively from the metadata of the chunks the
answer referenced by index (the prompt requires ``[1]``, ``[2]``, ...
references; the model never emits paragraph numbers, so it cannot invent a
§). The deterministic verifier checks:

(a) every referenced index was actually provided to the model;
(b) every cited § exists in the current index;
(c) any German text quoted in the answer (double-quoted spans) matches the
    referenced paragraph's record after whitespace and punctuation
    normalization - paragraph-level records make quotes spanning chunk
    boundaries verifiable; spans shorter than three words are exempt.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from retrieval.base import ScoredChunk

# [1], [2], [12] - bracketed chunk references in the answer text.
_CHUNK_REF_PATTERN = re.compile(r"\[(\d{1,2})\]")
# Double-quoted spans: German quotes per the prompt convention. The prompt
# asks for ASCII double quotes; German typographic quotes are accepted too.
_QUOTE_PATTERN = re.compile('["\u201e\u00ab]([^\u201c\u201d\u00bb"]{2,300})["\u201c\u201d\u00bb]')


@dataclass
class Citation:
    index: int
    paragraph: str
    absatz: str
    law_abbr: str
    german_text: str
    gloss_en: str
    deep_link: str

    def to_json(self) -> dict:
        return {
            "index": self.index,
            "paragraph": self.paragraph,
            "absatz": self.absatz,
            "law_abbr": self.law_abbr,
            "german_text": self.german_text,
            "gloss_en": self.gloss_en,
            "deep_link": self.deep_link,
        }


@dataclass
class VerificationResult:
    ok: bool
    failures: list[str]
    # every check that ran: {"kind": "ref" | "paragraph" | "quote", "target", "passed", "detail"}
    checks: list[dict] = field(default_factory=list)


def extract_chunk_refs(answer: str) -> list[int]:
    """Extract the chunk indexes the answer references, in order of appearance."""
    seen: list[int] = []
    for match in _CHUNK_REF_PATTERN.finditer(answer):
        index = int(match.group(1))
        if index not in seen:
            seen.append(index)
    return seen


def _normalize(text: str) -> str:
    """Whitespace/punctuation-normalized comparison form."""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\xa0", " ").replace("„", '"').replace("“", '"').replace("”", '"')
    text = text.replace("’", "'").replace("‘", "'").replace("–", "-").replace("—", "-")
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text, flags=re.UNICODE)  # drop punctuation
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _word_count(text: str) -> int:
    return len(_normalize(text).split())


def assemble_citations(answer: str, chunks: list[ScoredChunk]) -> list[Citation]:
    """Assemble citations from the metadata of the referenced chunks only."""
    citations: list[Citation] = []
    for index in extract_chunk_refs(answer):
        chunk = next((c for c in chunks if c.index == index), None)
        if chunk is None:
            continue  # the verifier reports this as a failure (a)
        citations.append(
            Citation(
                index=index,
                paragraph=chunk.paragraph,
                absatz=chunk.absatz,
                law_abbr=chunk.law_abbr,
                german_text=chunk.chunk_text,
                gloss_en=chunk.gloss_en,
                deep_link=f"https://www.gesetze-im-internet.de/bgb/__{chunk.paragraph}.html",
            )
        )
    return citations


def verify_answer(
    answer: str,
    chunks: list[ScoredChunk],
    paragraphs: dict[str, dict],
) -> VerificationResult:
    """Run the three deterministic citation checks against one answer."""
    failures: list[str] = []
    checks: list[dict] = []

    def check(kind: str, target: str, passed: bool, detail: str) -> None:
        checks.append({"kind": kind, "target": target, "passed": passed, "detail": detail})
        if not passed:
            failures.append(detail)

    refs = extract_chunk_refs(answer)

    provided = {c.index for c in chunks}
    for index in refs:
        if index in provided:
            check("ref", f"[{index}]", True, f"chunk [{index}] was provided to the model")
        else:
            check(
                "ref",
                f"[{index}]",
                False,
                f"referenced chunk [{index}] was not provided to the model",
            )

    cited_paras = set()
    for index in refs:
        chunk = next((c for c in chunks if c.index == index), None)
        if chunk is not None:
            cited_paras.add(chunk.paragraph)
    for paragraph in sorted(cited_paras):
        if paragraph in paragraphs:
            check("paragraph", f"§ {paragraph}", True, f"§ {paragraph} exists in the index")
        else:
            check(
                "paragraph",
                f"§ {paragraph}",
                False,
                f"cited § {paragraph} does not exist in the index",
            )

    for quote in _QUOTE_PATTERN.findall(answer):
        if _word_count(quote) < 3:
            continue  # short spans are exempt
        candidates = [
            (p, paragraphs[p]["full_text"]) for p in sorted(cited_paras) if p in paragraphs
        ]
        if not candidates:
            check(
                "quote",
                quote,
                False,
                f"quote {quote[:60]!r} has no referenced paragraph to check against",
            )
            continue
        normalized_quote = _normalize(quote)
        found = [p for p, text in candidates if normalized_quote in _normalize(text)]
        if found:
            check("quote", quote, True, f"found verbatim in § {found[0]}")
        else:
            check(
                "quote",
                quote,
                False,
                f"quote {quote[:60]!r} not found in the referenced paragraphs",
            )

    return VerificationResult(ok=not failures, failures=failures, checks=checks)
