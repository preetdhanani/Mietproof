"""Pipeline trace collection for the debug UI.

``TraceCollector`` records each stage of one /ask request: query
enrichment, per-backend retrieval scores, RRF fusion, the floor check, the
final prompt, generation attempts, and citation verification. The trace is
returned alongside the answer when the request asks for ``debug=true`` -
the recruiter-visible "thinking process" of the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class TraceCollector:
    request_id: str
    question: str
    stages: list[dict] = field(default_factory=list)

    def add(self, stage: str, data: dict[str, Any]) -> None:
        self.stages.append({"stage": stage, **data})

    def to_json(self) -> dict:
        return {"request_id": self.request_id, "question": self.question, "stages": self.stages}


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


def trace_bm25(collector: TraceCollector, hits: list) -> None:
    """Record the BM25 ranking with raw lexical scores."""
    collector.add(
        "bm25_retrieval",
        {
            "backend": "BM25Okapi (lexical, tokenized German)",
            "candidates": [
                {
                    "rank": c.index,
                    "paragraph": c.paragraph,
                    "absatz": c.absatz,
                    "score": round(c.score, 3),
                    "text_preview": c.chunk_text[:140],
                }
                for c in hits
            ],
            "note": "lexical match on shared vocabulary - weak across English->German",
        },
    )


def trace_dense(collector: TraceCollector, hits: list, fused_detail: dict | None = None) -> None:
    """Record the dense ranking with cosine scores and per-paragraph fusion."""
    data: dict[str, Any] = {
        "backend": "multilingual-e5 (cosine, paragraph space + chunk space)",
        "candidates": [
            {
                "rank": c.index,
                "paragraph": c.paragraph,
                "absatz": c.absatz,
                "score": round(c.score, 4),
                "text_preview": c.chunk_text[:140],
            }
            for c in hits
        ],
    }
    if fused_detail:
        data["per_paragraph_fusion"] = fused_detail
    collector.add("dense_retrieval", data)


def trace_fusion(collector: TraceCollector, final: list, weights: dict) -> None:
    """Record the RRF fusion that produced the final ranking."""
    collector.add(
        "hybrid_fusion",
        {
            "method": "weighted reciprocal rank fusion",
            "weights": weights,
            "final_ranking": [
                {
                    "rank": c.index,
                    "paragraph": c.paragraph,
                    "absatz": c.absatz,
                    "rrf_score": round(c.score, 6),
                    "text_preview": c.chunk_text[:140],
                }
                for c in final
            ],
        },
    )


def trace_floor(
    collector: TraceCollector, confidence: float, floor: float | None, passed: bool
) -> None:
    collector.add(
        "out_of_scope_floor",
        {
            "confidence": round(confidence, 4),
            "floor": floor,
            "passed": passed,
            "note": "below the floor -> covered-topics response instead of an answer"
            if not passed
            else "above the floor -> answering",
        },
    )


def trace_prompt(
    collector: TraceCollector, prompt: str, chunks: list, gap_note: str | None
) -> None:
    collector.add(
        "prompt_assembly",
        {
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
            "final_prompt": prompt,
            "note": "exactly what the LLM receives (system prompt + this user message)",
        },
    )


def trace_generation(
    collector: TraceCollector, attempt: int, answer: str, verification_ok: bool, failures: list[str]
) -> None:
    collector.add(
        f"generation_attempt_{attempt}",
        {
            "answer": answer,
            "verification_passed": verification_ok,
            "verification_failures": failures,
            "note": "citation verifier rejected this attempt - regenerating with feedback"
            if not verification_ok
            else "citations verified",
        },
    )


def trace_citations(collector: TraceCollector, citations: list[dict]) -> None:
    collector.add(
        "citation_assembly",
        {
            "citations": citations,
            "note": "assembled from chunk metadata only - the model never emits § numbers",
        },
    )
