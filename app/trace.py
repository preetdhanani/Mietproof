"""Pipeline trace collection for the debug UI.

``TraceCollector`` records each stage of one /ask request: query
enrichment, per-backend retrieval scores, RRF fusion, the floor check, the
final prompt, generation attempts, and citation verification. The trace is
returned alongside the answer when the request asks for ``debug=true`` -
the recruiter-visible "thinking process" of the pipeline.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TraceCollector:
    """Ordered stage log for one request.

    Every stage carries ``t_ms`` (ms since the request started) and
    ``duration_ms`` (ms since the previous stage, unless the caller measured
    the stage itself). ``listener`` sees every event as it happens -
    ``{"type": "stage", "stage": ...}`` per stage plus the LLM's streamed
    ``llm_start`` / ``delta`` events - so the streaming endpoint can push
    them to the UI live.
    """

    request_id: str
    question: str
    stages: list[dict] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)
    listener: Callable[[dict], None] | None = None  # receives events, not bare stages
    clock: Callable[[], float] = time.monotonic
    _started: float = field(init=False)
    _last: float = field(init=False)

    def __post_init__(self) -> None:
        self._started = self._last = self.clock()

    def add(self, stage: str, data: dict[str, Any], duration_ms: float | None = None) -> None:
        now = self.clock()
        measured = (now - self._last) * 1000 if duration_ms is None else duration_ms
        entry = {
            "stage": stage,
            **data,
            "t_ms": round((now - self._started) * 1000, 1),
            "duration_ms": round(measured, 1),
        }
        self._last = now
        self.stages.append(entry)
        self.emit({"type": "stage", "stage": entry})

    def emit(self, event: dict) -> None:
        """Forward a live event to the listener (not kept in the trace)."""
        if self.listener is not None:
            self.listener(event)

    def mark(self) -> None:
        """Restart the per-stage clock (so the next stage times only its own work)."""
        self._last = self.clock()

    def elapsed_ms(self) -> float:
        return round((self.clock() - self._started) * 1000, 1)

    def to_json(self) -> dict:
        return {
            "request_id": self.request_id,
            "question": self.question,
            "meta": self.meta,
            "total_ms": self.elapsed_ms(),
            "stages": self.stages,
        }


def trace_enrichment(collector: TraceCollector, query: str, enriched: str | None) -> None:
    """Record the EN->DE lexicon enrichment (which terms fired)."""
    if enriched is None or enriched == query:
        collector.add(
            "query_enrichment",
            {
                "original": query,
                "enriched": query,
                "terms_added": [],
                "note": "no lexicon terms matched",
            },
        )
        return
    terms_added = enriched[len(query) :].strip().split()
    collector.add(
        "query_enrichment",
        {
            "original": query,
            "enriched": enriched,
            "terms_added": terms_added,
            "note": "German legal terms appended for cross-lingual matching",
        },
    )


def trace_bm25(collector: TraceCollector, query: str, candidates: list[dict], detail: dict) -> None:
    """Record the BM25 ranking with each hit's per-term score breakdown."""
    collector.add(
        "bm25_retrieval",
        {
            "backend": "BM25Okapi (lexical)",
            "query": query,
            "candidates": candidates,
            **detail,
            "note": "BM25 receives the question as typed (the EN->DE enrichment feeds only the "
            "dense side) - shared words are rare across English->German",
        },
        duration_ms=detail.get("duration_ms"),
    )


def trace_dense(collector: TraceCollector, detail: dict, duration_ms: float | None = None) -> None:
    """Record the dense ranking: paragraph-space and chunk-space cosines."""
    collector.add(
        "dense_retrieval",
        {"backend": "multilingual-e5 (cosine, paragraph + chunk spaces)", **detail},
        duration_ms=duration_ms,
    )


def trace_fusion(
    collector: TraceCollector,
    final: list,
    fusion_rows: list[dict],
    weights: dict,
    duration_ms: float,
) -> None:
    """Record the RRF fusion: the chosen top k and every candidate it ranked."""
    texts = {(c.paragraph, c.absatz): c.chunk_text[:140] for c in final}
    collector.add(
        "hybrid_fusion",
        {
            "method": "weighted reciprocal rank fusion",
            "weights": weights,
            "final_ranking": [
                {**row, "text_preview": texts.get((row["paragraph"], row["absatz"]), "")}
                for row in fusion_rows
                if row["selected"]
            ],
            "candidates": fusion_rows,
        },
        duration_ms=duration_ms,
    )


def trace_floor(
    collector: TraceCollector,
    confidence: float,
    floor: float | None,
    passed: bool,
    components: dict | None = None,
) -> None:
    collector.add(
        "out_of_scope_floor",
        {
            "confidence": round(confidence, 4),
            "floor": floor,
            "passed": passed,
            "components": components or {},
            "formula": "(max(best chunk cosine, best paragraph cosine) + 1) / 2",
            "note": "below the floor -> covered-topics response instead of an answer"
            if not passed
            else "above the floor -> answering",
        },
    )


def trace_prompt(
    collector: TraceCollector,
    messages: list[dict],
    sections: list[dict],
    chunks: list,
    gap_note: str | None,
    params: dict,
) -> None:
    """Record exactly what the LLM receives: the messages as sent, the user
    message broken into its parts, and the call parameters."""
    system = messages[0]["content"] if messages and messages[0]["role"] == "system" else ""
    collector.add(
        "prompt_assembly",
        {
            "messages": messages,
            "sections": sections,
            "params": params,
            "retrieved_chunks_sent": [
                {
                    "index": c.index,
                    "paragraph": c.paragraph,
                    "absatz": c.absatz,
                    "text": c.chunk_text,
                }
                for c in chunks
            ],
            "gap_annotation_injected": gap_note,
            "final_prompt": messages[-1]["content"],
            "system_prompt_repeated_in_user_message": bool(system)
            and system in messages[-1]["content"],
            "note": "exactly what the LLM receives (system message + user message)",
        },
    )


def trace_generation(
    collector: TraceCollector,
    attempt: int,
    answer: str,
    verification,
    info: dict | None = None,
) -> None:
    """Record one LLM attempt: its output, reasoning, timing, tokens, and
    every verification check run against it."""
    info = info or {}
    collector.add(
        f"generation_attempt_{attempt}",
        {
            "answer": answer,
            "reasoning": info.get("reasoning", ""),
            "usage": info.get("usage", {}),
            "usage_estimated": info.get("usage_estimated", False),
            "ttft_ms": info.get("ttft_ms"),
            "verification_passed": verification.ok,
            "verification_failures": verification.failures,
            "verification_checks": verification.checks,
            "note": "citation verifier rejected this attempt - regenerating with feedback"
            if not verification.ok
            else "citations verified",
        },
    )


class DeltaBatcher:
    """Groups streamed LLM text into ~50 ms / 64-char ``delta`` events so the
    live UI gets smooth updates without one event per token."""

    def __init__(
        self,
        collector: TraceCollector,
        attempt: int,
        max_chars: int = 64,
        max_wait_s: float = 0.05,
    ):
        self.collector = collector
        self.attempt = attempt
        self.max_chars = max_chars
        self.max_wait_s = max_wait_s
        self._kind: str | None = None
        self._parts: list[str] = []
        self._size = 0
        self._since = collector.clock()
        collector.emit({"type": "llm_start", "attempt": attempt})

    def push(self, kind: str, text: str) -> None:
        if self._kind is not None and kind != self._kind:
            self.flush()
        self._kind = kind
        self._parts.append(text)
        self._size += len(text)
        if self._size >= self.max_chars or self.collector.clock() - self._since >= self.max_wait_s:
            self.flush()

    def flush(self) -> None:
        if self._parts and self._kind is not None:
            self.collector.emit(
                {
                    "type": "delta",
                    "attempt": self.attempt,
                    "kind": self._kind,
                    "text": "".join(self._parts),
                }
            )
        self._parts, self._size, self._since = [], 0, self.collector.clock()


def trace_citations(collector: TraceCollector, citations: list[dict]) -> None:
    collector.add(
        "citation_assembly",
        {
            "citations": citations,
            "note": "assembled from chunk metadata only - the model never emits § numbers",
        },
    )
