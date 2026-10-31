"""HTTP surface: /ask with and without the trace, /ask/stream event order,
guardrail errors before the stream opens, errors inside the stream, stage
timings, and token-budget recording."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import Settings
from app.guardrails import LLMSemaphore, RateLimiter, TokenBudget
from app.llm import LLMError
from app.pipeline import AskResult


class FakePipeline:
    """Emits a few trace stages and returns a scripted result."""

    def __init__(self, fail_with: Exception | None = None):
        self.fail_with = fail_with

    def ask(self, question, session_id=None, request_id="", now=0.0, collector=None):
        if collector is not None:
            collector.add("query_enrichment", {"original": question, "terms_added": []})
            collector.add("bm25_retrieval", {"candidates": []}, duration_ms=1.5)
            collector.emit({"type": "llm_start", "attempt": 1})
            collector.emit({"type": "delta", "attempt": 1, "kind": "content", "text": "ok"})
            collector.add("generation_attempt_1", {"answer": "ok", "verification_passed": True})
        if self.fail_with is not None:
            raise self.fail_with
        return AskResult(
            answer="The tenancy ends [1].",
            citations=[{"index": 1, "paragraph": "542", "absatz": "2"}],
            stand_date="2026-07-23",
            request_id=request_id,
            behavior="answer",
            usage={"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120},
        )


@pytest.fixture
def client(tmp_path):
    settings = Settings(_env_file=None, LLM_MODEL="test-model", RETRIEVAL_BACKEND="hybrid")
    main._state.clear()
    main._state.update(
        settings=settings,
        rate_limiter=RateLimiter(100),
        semaphore=LLMSemaphore(2),
        budget=TokenBudget(demo_budget=1000, state_path=tmp_path / "budget.json"),
        pipeline=FakePipeline(),
        tracer=None,
    )
    yield TestClient(main.app)
    main._state.clear()


def stream_events(client: TestClient, question: str = "When does my lease end?") -> list[dict]:
    with client.stream("POST", "/ask/stream", json={"question": question}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-ndjson")
        return [json.loads(line) for line in response.iter_lines() if line]


def test_ask_without_debug_has_no_trace(client) -> None:
    body = client.post("/ask", json={"question": "When does my lease end?"}).json()
    assert body["answer"] == "The tenancy ends [1]."
    assert body["trace"] is None


def test_ask_with_debug_returns_timed_trace_and_meta(client) -> None:
    body = client.post("/ask", json={"question": "q", "debug": True}).json()
    trace = body["trace"]
    assert trace["meta"]["llm_model"] == "test-model"
    assert trace["usage"]["total_tokens"] == 120
    t_values = [s["t_ms"] for s in trace["stages"]]
    assert t_values == sorted(t_values)
    assert all(s["duration_ms"] >= 0 for s in trace["stages"])
    assert trace["stages"][1]["duration_ms"] == 1.5  # explicit timing wins
    assert trace["total_ms"] >= t_values[-1]


def test_ask_records_token_spend(client) -> None:
    client.post("/ask", json={"question": "q"})
    assert main._state["budget"].spent_today() == 120


def test_stream_event_order(client) -> None:
    events = stream_events(client)
    assert [e["type"] for e in events] == [
        "start",
        "stage",
        "stage",
        "llm_start",
        "delta",
        "stage",
        "result",
    ]
    assert events[4] == {"type": "delta", "attempt": 1, "kind": "content", "text": "ok"}
    assert events[0]["meta"]["retrieval_backend"] == "hybrid"
    streamed = [e["stage"]["stage"] for e in events if e["type"] == "stage"]
    assert streamed == ["query_enrichment", "bm25_retrieval", "generation_attempt_1"]
    response = events[-1]["response"]
    assert response["request_id"] == events[0]["request_id"]
    # live-only events never end up in the stored trace
    assert [s["stage"] for s in response["trace"]["stages"]] == streamed


def test_stream_llm_failure_is_an_error_event(client) -> None:
    main._state["pipeline"] = FakePipeline(fail_with=LLMError("down"))
    events = stream_events(client)
    assert [e["type"] for e in events][-1] == "error"
    assert events[-1]["status"] == 503
    assert "LLM endpoint unavailable" in events[-1]["error"]
    # the stages that ran before the failure were still streamed
    assert sum(e["type"] == "stage" for e in events) == 3


def test_stream_unexpected_failure_is_an_error_event(client) -> None:
    main._state["pipeline"] = FakePipeline(fail_with=RuntimeError("boom"))
    events = stream_events(client)
    assert events[-1] == {
        "type": "error",
        "status": 500,
        "error": "internal error",
        "request_id": events[0]["request_id"],
    }


def test_stream_rate_limit_fails_before_stream_opens(client) -> None:
    main._state["rate_limiter"] = RateLimiter(0)
    response = client.post("/ask/stream", json={"question": "q"})
    assert response.status_code == 429
    assert response.json()["detail"]["error"] == "rate limit exceeded"


def test_stream_without_index_fails_before_stream_opens(client) -> None:
    main._state["pipeline"] = None
    response = client.post("/ask/stream", json={"question": "q"})
    assert response.status_code == 503


def test_semaphore_released_after_requests(client) -> None:
    stream_events(client)
    client.post("/ask", json={"question": "q"})
    assert main._state["semaphore"]._semaphore._value == 2
