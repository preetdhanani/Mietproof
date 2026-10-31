"""Live diagnostics plumbing: the streaming LLM client (SSE parsing, retry
only before the stream starts), delta batching, the BM25 score breakdown,
and the tokenizer keeping umlaut words whole."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from app.config import LLMEndpointConfig
from app.llm import LLMError, chat_completion_stream
from app.trace import DeltaBatcher, TraceCollector
from retrieval.bm25 import BM25Retriever, tokenize

FIXTURE = Path(__file__).parent / "fixtures" / "collection"
ENDPOINT = LLMEndpointConfig(base_url="http://llm.test/v1", model="m", api_key="k")


def sse(*events: str) -> bytes:
    return "".join(f"{e}\n\n" for e in events).encode()


def client_for(*responses: httpx.Response) -> tuple[httpx.Client, list]:
    queue = list(responses)
    calls: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return queue.pop(0)

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


GOOD_STREAM = sse(
    ": keepalive",
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    'data: {"choices":[{"delta":{"reasoning_content":"Think "}}]}',
    'data: {"choices":[{"delta":{"reasoning":"more."}}]}',
    'data: {"choices":[{"delta":{"content":"Answer "}}]}',
    'data: {"choices":[{"delta":{"content":"[1]."}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}',
    "data: [DONE]",
)


def test_stream_reassembles_reasoning_content_and_usage() -> None:
    client, calls = client_for(httpx.Response(200, content=GOOD_STREAM))
    deltas: list = []
    result = chat_completion_stream(
        ENDPOINT,
        [{"role": "user", "content": "q"}],
        lambda k, t: deltas.append((k, t)),
        client=client,
    )
    assert result.content == "Answer [1]."
    assert result.reasoning == "Think more."
    assert result.usage["total_tokens"] == 14
    assert result.ttft_ms is not None
    assert deltas[0] == ("reasoning", "Think ") and deltas[-1] == ("content", "[1].")
    body = calls[0].read().decode()
    assert '"stream":true' in body.replace(" ", "")


def test_stream_retries_before_the_first_byte() -> None:
    client, calls = client_for(httpx.Response(503), httpx.Response(200, content=GOOD_STREAM))
    result = chat_completion_stream(
        ENDPOINT, [], lambda k, t: None, client=client, sleep_fn=lambda s: None
    )
    assert result.content == "Answer [1]."
    assert len(calls) == 2


def test_stream_non_retryable_status_fails_fast() -> None:
    client, calls = client_for(httpx.Response(400, text="bad request"))
    with pytest.raises(LLMError, match="HTTP 400"):
        chat_completion_stream(ENDPOINT, [], lambda k, t: None, client=client)
    assert len(calls) == 1


def test_stream_error_payload_inside_200_raises() -> None:
    client, _ = client_for(
        httpx.Response(200, content=sse('data: {"error":{"message":"overloaded"}}'))
    )
    with pytest.raises(LLMError, match="overloaded"):
        chat_completion_stream(ENDPOINT, [], lambda k, t: None, client=client)


def test_stream_broken_midway_raises_without_retry() -> None:
    client, calls = client_for(
        httpx.Response(
            200, content=sse('data: {"choices":[{"delta":{"content":"Ans"}}]}', "data: {broken")
        )
    )
    with pytest.raises(LLMError, match="broke midway"):
        chat_completion_stream(ENDPOINT, [], lambda k, t: None, client=client)
    assert len(calls) == 1


def test_delta_batcher_groups_text_and_splits_on_kind_change() -> None:
    now = [0.0]
    events: list = []
    collector = TraceCollector(
        request_id="r", question="q", listener=events.append, clock=lambda: now[0]
    )
    batcher = DeltaBatcher(collector, attempt=2, max_chars=10, max_wait_s=1.0)
    for piece in ("ab", "cd", "efghij"):  # reaches 10 chars on the third piece
        batcher.push("reasoning", piece)
    batcher.push("reasoning", "k")
    batcher.push("content", "X")  # kind change flushes the pending reasoning
    batcher.flush()
    assert events[0] == {"type": "llm_start", "attempt": 2}
    assert [(e["kind"], e["text"]) for e in events[1:]] == [
        ("reasoning", "abcdefghij"),
        ("reasoning", "k"),
        ("content", "X"),
    ]
    assert all(e["attempt"] == 2 for e in events[1:])


def test_tokenizer_keeps_umlaut_words_whole() -> None:
    assert tokenize("Kündigung der Mieterhöhung, Straße!") == [
        "kundigung",
        "der",
        "mieterhohung",
        "straße",
    ]


def test_bm25_term_contributions_sum_to_score() -> None:
    bm25 = BM25Retriever(FIXTURE)
    # repeated tokens count per repeat; "der" is common (floor idf); "zzz" is unknown
    query = "Mietvertrag Mietvertrag Vermieter der Ablauf zzz"
    hits, detail = bm25.retrieve_debug(query, k=5)
    assert detail["query_tokens"] == tokenize(query)
    assert detail["idf"]["zzz"] == 0.0
    assert len(detail["all_scores"]) == detail["params"]["n_chunks"]
    for hit, explanation in zip(hits, detail["explanations"], strict=True):
        total = sum(t["contribution"] for t in explanation["terms"])
        assert total == pytest.approx(hit.score, abs=0.01)
        assert all(t["tf"] > 0 for t in explanation["terms"])
