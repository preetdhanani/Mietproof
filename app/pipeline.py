"""Request orchestration - the single definition of the request flow.

rewrite-if-follow-up -> retrieve -> retrieval-confidence floor -> generate ->
assemble citations -> verify -> respond. German input is detected by the
character/stop-word heuristic and answered with a fixed template. When a
retrieved chunk's text or the query matches a gap-annotation entry's keyword
list, the matching entry is injected into the prompt so the answer can name
what the statute does and does not regulate.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from app.citations import VerificationResult, assemble_citations, verify_answer
from app.config import LLMEndpointConfig
from app.llm import chat_completion, chat_completion_stream
from app.rewriting import is_follow_up, rewrite_query
from app.trace import (
    DeltaBatcher,
    TraceCollector,
    trace_bm25,
    trace_citations,
    trace_dense,
    trace_enrichment,
    trace_floor,
    trace_fusion,
    trace_generation,
    trace_prompt,
)
from retrieval.base import Retriever, ScoredChunk
from retrieval.enrich import enrich_query

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
GAP_ANNOTATIONS_PATH = REPO_ROOT / "app" / "gap_annotations.json"
PROMPTS_DIR = REPO_ROOT / "app" / "prompts"
FLOOR_BASELINE_PATH = REPO_ROOT / "evals" / "baselines" / "floor.json"

MAX_REGENERATION_ATTEMPTS = 2
GENERATION_PARAMS = {"temperature": 0.0, "max_tokens": 1024}  # chat_completion defaults
SESSION_TTL_SECONDS = 30 * 60
SESSION_MAX_EXCHANGES = 3

DISCLAIMER = "This is general statutory information, not legal advice."

GERMAN_STOP_WORDS = (
    "und",
    "der",
    "die",
    "das",
    "ist",
    "nicht",
    "mit",
    "für",
    "auf",
    "ein",
    "eine",
    "ich",
    "muss",
    "kann",
    "hat",
    "wie",
    "was",
    "wenn",
    "bei",
    "von",
    "dem",
    "den",
    "des",
    "sich",
    "werden",
    "wird",
    "meine",
    "mein",
    "miete",
    "vermieter",
    "mieter",
    "kündigung",
    "frist",
    "wohnung",
    "vertrag",
)
GERMAN_CHARS = re.compile(r"[äöüßÄÖÜ]")

GERMAN_RESPONSE_TEMPLATE = (
    "This assistant answers in English only. Your question appears to be in "
    "German. For the German original of the relevant provisions, see "
    "https://www.gesetze-im-internet.de/bgb/ (BGB, Mietrecht: §§ 535-580a). "
    "You are welcome to ask your question again in English."
)


def looks_german(query: str) -> bool:
    """Heuristic German detection: umlauts/ß plus German stop words."""
    has_umlauts = bool(GERMAN_CHARS.search(query))
    words = {w.lower().strip(".,!?;:") for w in query.split()}
    stop_hits = len(words & set(GERMAN_STOP_WORDS))
    return has_umlauts and stop_hits >= 1 or stop_hits >= 2


@dataclass
class AskResult:
    answer: str
    citations: list[dict]
    stand_date: str
    request_id: str
    behavior: str  # "answer" | "out_of_scope" | "german_input" | "refusal"
    gap_note: str | None = None
    verification: VerificationResult | None = None
    retrieved: list[dict] = field(default_factory=list)
    usage: dict = field(default_factory=dict)  # summed LLM token usage


class SessionStore:
    """In-process session store: last 3 exchanges with a 30-minute TTL."""

    def __init__(
        self,
        ttl_seconds: int = SESSION_TTL_SECONDS,
        max_exchanges: int = SESSION_MAX_EXCHANGES,
    ):
        self.ttl = ttl_seconds
        self.max_exchanges = max_exchanges
        self._sessions: dict[str, tuple[float, list[dict]]] = {}

    def get_history(self, session_id: str, now: float) -> list[dict]:
        entry = self._sessions.get(session_id)
        if entry is None or now - entry[0] > self.ttl:
            return []
        return entry[1]

    def append(self, session_id: str, question: str, answer: str, now: float) -> None:
        history = self.get_history(session_id, now)
        exchange = [{"role": "user", "content": question}, {"role": "assistant", "content": answer}]
        history = history + exchange
        self._sessions[session_id] = (now, history[-2 * self.max_exchanges :])


def load_floor(baseline_path: Path = FLOOR_BASELINE_PATH) -> float | None:
    """Load the calibrated out-of-scope floor from evals/baselines/floor.json."""
    try:
        data = json.loads(baseline_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    floor = data.get("floor")
    return float(floor) if floor is not None else None


def load_gap_annotations(path: Path = GAP_ANNOTATIONS_PATH) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.warning("gap annotations missing or invalid at %s", path)
        return {"schema_version": 1, "topics": []}


def match_gap_annotations(query: str, chunks: list[ScoredChunk], annotations: dict) -> dict | None:
    """First annotation entry whose keywords match the query or retrieved text."""
    haystack = query.lower()
    matched_topics: dict | None = None
    for entry in annotations.get("topics", []):
        keywords = entry.get("keywords", [])
        if any(k.lower() in haystack for k in keywords):
            return entry
    for chunk in chunks:
        text = chunk.chunk_text.lower()
        for entry in annotations.get("topics", []):
            if any(k.lower() in text for k in entry.get("keywords", [])):
                matched_topics = matched_topics or entry
    return matched_topics


def covered_topics(annotations: dict, laws: list[str]) -> list[str]:
    """Covered-topics list from the gap-annotation map and the manifest law list."""
    topics = [entry["topic"].replace("_", " ") for entry in annotations.get("topics", [])]
    return sorted(set(topics)) or [f"general {law} rental law" for law in laws]


class Pipeline:
    def __init__(
        self,
        retriever: Retriever,
        generator: LLMEndpointConfig,
        answer_prompt: str,
        rewrite_prompt: str,
        paragraphs: dict[str, dict],
        stand_date: str,
        laws: list[str],
        floor: float | None = None,
        annotations: dict | None = None,
        rewrite_enabled: bool = True,
    ):
        self.retriever = retriever
        self.generator = generator
        self.answer_prompt = answer_prompt
        self.rewrite_prompt = rewrite_prompt
        self.paragraphs = paragraphs
        self.stand_date = stand_date
        self.laws = laws
        self.floor = floor
        self.annotations = annotations if annotations is not None else load_gap_annotations()
        self.rewrite_enabled = rewrite_enabled
        self.sessions = SessionStore()

    def _effective_floor(self) -> float | None:
        return self.floor

    def ask(
        self,
        question: str,
        session_id: str | None = None,
        request_id: str = "",
        now: float = 0.0,
        history: list[dict] | None = None,
        collector: TraceCollector | None = None,
    ) -> AskResult:
        if collector is not None:
            collector.mark()  # time stages from here, not from queueing for a worker
        if looks_german(question):
            if collector is not None:
                collector.add(
                    "german_input_detection",
                    {
                        "question": question,
                        "note": "umlaut/stop-word heuristic fired - fixed template, no LLM call",
                    },
                )
            return AskResult(
                answer=GERMAN_RESPONSE_TEMPLATE,
                citations=[],
                stand_date=self.stand_date,
                request_id=request_id,
                behavior="german_input",
            )

        working_query = question
        total_usage: dict[str, int] = {}
        if session_id and self.rewrite_enabled and is_follow_up(question, True):
            prior = history if history is not None else self.sessions.get_history(session_id, now)
            if prior:
                if collector is not None:
                    collector.add(
                        "follow_up_rewrite",
                        {
                            "original": question,
                            "history_used": prior[-2:],
                            "note": "follow-up detected -> LLM rewrite before retrieval",
                        },
                    )
                rewrite_usage: dict = {}
                rewrite_status: dict = {}
                working_query = rewrite_query(
                    question,
                    prior,
                    self.generator,
                    self.rewrite_prompt,
                    usage_out=rewrite_usage,
                    status_out=rewrite_status,
                )
                _add_usage(total_usage, rewrite_usage)
                if collector is not None:
                    collector.add(
                        "follow_up_rewrite_result",
                        {
                            "rewritten": working_query,
                            "usage": rewrite_usage,
                            "fell_back": rewrite_status.get("fell_back", False),
                            "note": "no rewrite returned - searching with the question as typed"
                            if rewrite_status.get("fell_back")
                            else "standalone retrieval query",
                        },
                    )

        components: dict | None = None
        if collector is not None:
            trace_enrichment(collector, working_query, enrich_query(working_query))
            chunks, components = self._retrieve_traced(collector, working_query)
            collector.mark()
        else:
            chunks = self.retriever.retrieve(working_query, k=5)

        floor = self._effective_floor()
        if components is not None:  # computed from the same query vector as retrieval
            confidence = components["value"]
        else:
            confidence = self.retriever.confidence(working_query)
        if collector is not None:
            trace_floor(
                collector, confidence, floor, floor is None or confidence >= floor, components
            )
        if floor is not None and chunks and confidence < floor:
            result = self._out_of_scope(request_id, chunks)
            result.usage = total_usage  # a follow-up rewrite may have spent tokens
            if collector is not None:
                collector.add(
                    "out_of_scope_response",
                    {
                        "topics": covered_topics(self.annotations, self.laws),
                        "note": "below the floor - covered-topics list returned, no LLM call",
                    },
                )
            return result

        gap_entry = match_gap_annotations(question, chunks, self.annotations)
        attempts = 0
        feedback: str | None = None
        while True:
            attempts += 1
            sections = self._prompt_sections(question, chunks, gap_entry, feedback=feedback)
            prompt = "\n".join(section["text"] for section in sections)
            if collector is not None:
                trace_prompt(
                    collector,
                    self._messages(prompt),
                    sections,
                    chunks,
                    self._gap_note(gap_entry),
                    {"model": self.generator.model if self.generator else "", **GENERATION_PARAMS},
                )
                collector.mark()
                batcher = DeltaBatcher(collector, attempts)
                answer, info = self._generate(prompt, on_delta=batcher.push)
                batcher.flush()
            else:
                answer, info = self._generate(prompt)
            _add_usage(total_usage, info.get("usage") or {})
            verification = verify_answer(answer, chunks, self.paragraphs)
            if collector is not None:
                trace_generation(collector, attempts, answer, verification, info)
            if verification.ok or attempts >= MAX_REGENERATION_ATTEMPTS:
                break
            feedback = "\n".join(f"- {f}" for f in verification.failures)

        if not verification.ok:
            result = self._refusal(request_id, chunks, verification)
            result.usage = total_usage
            if collector is not None:
                collector.add(
                    "refusal",
                    {
                        "note": "verification failed twice - nearest paragraphs shown instead",
                        "failures": verification.failures,
                    },
                )
            return result

        citations = assemble_citations(answer, chunks)
        if collector is not None:
            trace_citations(collector, [c.to_json() for c in citations])
        if session_id:
            self.sessions.append(session_id, question, answer, now)
        return AskResult(
            answer=answer,
            citations=[c.to_json() for c in citations],
            stand_date=self.stand_date,
            request_id=request_id,
            behavior="answer",
            gap_note=self._gap_note(gap_entry),
            verification=verification,
            retrieved=[c.to_json() for c in chunks],
            usage=total_usage,
        )

    def _retrieve_traced(
        self, collector: TraceCollector, working_query: str
    ) -> tuple[list, dict | None]:
        """Retrieve once through the retriever's debug view and record each
        arm (BM25, dense, fusion) with its own timing. Also returns the
        confidence components when the debug view computed them."""
        debug = getattr(self.retriever, "retrieve_debug", None)
        if debug is None:
            started = time.perf_counter()
            chunks = self.retriever.retrieve(working_query, k=5)
            collector.add(
                "retrieval",
                {"backend": type(self.retriever).__name__, "note": "no debug view available"},
                duration_ms=(time.perf_counter() - started) * 1000,
            )
            return chunks, None
        started = time.perf_counter()
        chunks, detail = debug(working_query, k=5)
        if "fusion" in detail:  # hybrid
            timings = detail["timings_ms"]
            trace_bm25(
                collector,
                working_query,
                detail["bm25_top10"],
                {**detail["bm25_detail"], "duration_ms": timings["bm25"]},
            )
            trace_dense(
                collector,
                {**detail["dense_per_paragraph"], "top10": detail["dense_top10"]},
                timings["dense"],
            )
            trace_fusion(collector, chunks, detail["fusion"], detail["weights"], timings["fusion"])
            return chunks, detail["confidence"]
        # dense
        components = detail.pop("confidence", None)
        trace_dense(collector, detail, (time.perf_counter() - started) * 1000)
        return chunks, components

    def _gap_note(self, gap_entry: dict | None) -> str | None:
        if gap_entry is None:
            return None
        return (
            f"{gap_entry['what_the_statute_regulates']} {gap_entry['what_is_governed_elsewhere']}"
        )

    def _out_of_scope(self, request_id: str, chunks: list[ScoredChunk]) -> AskResult:
        topics = covered_topics(self.annotations, self.laws)
        listing = ", ".join(topics)
        return AskResult(
            answer=(
                "This question appears to be outside what this assistant covers. "
                f"It answers questions about German rental law ({', '.join(self.laws)}, "
                f"§§ 535-580a BGB): {listing}. Please ask a question within these topics."
            ),
            citations=[],
            stand_date=self.stand_date,
            request_id=request_id,
            behavior="out_of_scope",
            retrieved=[c.to_json() for c in chunks],
        )

    def _refusal(
        self, request_id: str, chunks: list[ScoredChunk], verification: VerificationResult
    ) -> AskResult:
        nearest = []
        for chunk in chunks[:3]:
            nearest.append(
                {
                    "paragraph": chunk.paragraph,
                    "absatz": chunk.absatz,
                    "german_text": chunk.chunk_text,
                    "gloss_en": chunk.gloss_en,
                    "deep_link": f"https://www.gesetze-im-internet.de/bgb/__{chunk.paragraph}.html",
                }
            )
        return AskResult(
            answer=(
                "I could not produce an answer whose citations pass verification. "
                "Instead of an unverified answer, here are the nearest retrieved "
                "paragraphs for your question."
            ),
            citations=nearest,
            stand_date=self.stand_date,
            request_id=request_id,
            behavior="refusal",
            verification=verification,
            retrieved=[c.to_json() for c in chunks],
        )

    def _prompt_sections(
        self,
        question: str,
        chunks: list[ScoredChunk],
        gap_entry: dict | None,
        feedback: str | None = None,
    ) -> list[dict]:
        """The user message as labelled parts; joined with newlines they are
        the exact text sent to the LLM."""
        sections = [
            {"kind": "rules", "label": "answer rules", "text": self.answer_prompt},
            {"kind": "scaffold", "label": "", "text": "\nRetrieved chunks:"},
        ]
        for chunk in chunks:
            heading = self.paragraphs.get(chunk.paragraph, {}).get("heading", "")
            label = f"[{chunk.index}] § {chunk.paragraph}"
            sections.append(
                {
                    "kind": "chunk",
                    "label": label,
                    "text": f"{label} BGB ({heading}): {chunk.chunk_text}",
                }
            )
        if gap_entry is not None:
            sections.append(
                {
                    "kind": "gap_note",
                    "label": "scope note",
                    "text": "\nContext note (precomputed): "
                    + self._gap_note(gap_entry)
                    + " If relevant, state explicitly what the statute does and does not "
                    "regulate here.",
                }
            )
        if feedback:
            sections.append(
                {
                    "kind": "feedback",
                    "label": "verifier feedback",
                    "text": f"\nYour previous attempt failed citation verification:\n{feedback}\n"
                    "Fix these issues: reference only provided chunk indexes and quote "
                    "German text exactly as it appears in the chunks.",
                }
            )
        sections.append(
            {"kind": "question", "label": "question", "text": f"\nQuestion: {question}"}
        )
        return sections

    def _messages(self, prompt: str) -> list[dict]:
        return [
            {"role": "system", "content": self.answer_prompt},
            {"role": "user", "content": prompt},
        ]

    def _generate(self, prompt: str, on_delta=None) -> tuple[str, dict]:
        """One LLM call. Streams through ``on_delta(kind, text)`` when given.
        Returns the answer and call info: usage (estimated at ~4 characters
        per token when the endpoint reports none, so the budget still
        counts), reasoning, ttft_ms."""
        messages = self._messages(prompt)
        if on_delta is not None:
            streamed = chat_completion_stream(
                self.generator, messages, on_delta, **GENERATION_PARAMS
            )
            answer, usage = streamed.content.strip(), streamed.usage
            info = {"reasoning": streamed.reasoning, "ttft_ms": streamed.ttft_ms}
        else:
            body = chat_completion(self.generator, messages=messages, **GENERATION_PARAMS)
            answer = (body["choices"][0]["message"]["content"] or "").strip()
            usage, info = body.get("usage") or {}, {}
        if not usage.get("total_tokens"):
            prompt_tokens = sum(len(m["content"]) for m in messages) // 4
            completion_tokens = (len(answer) + len(info.get("reasoning", ""))) // 4
            usage = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            }
            info["usage_estimated"] = True
        info["usage"] = usage
        return answer, info


def _add_usage(total: dict[str, int], usage: dict) -> None:
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        if isinstance(usage.get(key), int):
            total[key] = total.get(key, 0) + usage[key]
