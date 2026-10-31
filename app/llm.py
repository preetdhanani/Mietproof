"""Thin OpenAI-compatible chat-completions client.

Base URL + model come from config. Retries with backoff on 429/5xx.
Deliberately no provider-specific features (no tool calling, no provider
JSON modes) - that keeps the swap surface at the HTTP layer only. This
constraint applies to the generator client only; the RAGAS adapter runs its
own client for the judge, where structured output is required.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx

from app.config import LLMEndpointConfig

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
MAX_RETRIES = 3
BACKOFF_SECONDS = 2.0


class LLMError(Exception):
    """The LLM endpoint failed after retries (maps to HTTP 503 upstream)."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def chat_completion(
    endpoint: LLMEndpointConfig,
    messages: list[dict],
    temperature: float = 0.0,
    max_tokens: int = 1024,
    timeout: float = 60.0,
    sleep_fn: Callable[[float], None] = time.sleep,
    client: httpx.Client | None = None,
) -> dict:
    """POST /chat/completions with retry-with-backoff on 429/5xx.

    Returns the parsed JSON response body. Raises LLMError on final failure.
    """
    if not endpoint.configured():
        raise LLMError("LLM endpoint not configured (LLM_BASE_URL / LLM_MODEL unset)")
    headers = {"Authorization": "Bearer " + endpoint.api_key} if endpoint.api_key else {}
    payload = {
        "model": endpoint.model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    owns_client = client is None
    client = client or httpx.Client(timeout=timeout)
    try:
        last_error: str | None = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = client.post(
                    f"{endpoint.base_url.rstrip('/')}/chat/completions",
                    headers=headers,
                    json=payload,
                )
            except httpx.HTTPError as exc:
                last_error = f"connection error: {exc}"
                status = None
            else:
                if response.status_code == 200:
                    return response.json()
                if response.status_code in RETRYABLE_STATUS:
                    last_error = f"HTTP {response.status_code}"
                    status = response.status_code
                else:
                    raise LLMError(
                        f"LLM endpoint returned HTTP {response.status_code}: {response.text[:200]}",
                        status=response.status_code,
                    )
            if attempt < MAX_RETRIES:
                sleep_fn(BACKOFF_SECONDS * (2**attempt))
        raise LLMError(
            f"LLM endpoint failed after {MAX_RETRIES + 1} attempts: {last_error}",
            status=status,
        )
    finally:
        if owns_client:
            client.close()


@dataclass
class StreamedCompletion:
    """A streamed chat completion, reassembled."""

    content: str = ""
    reasoning: str = ""
    usage: dict = field(default_factory=dict)
    ttft_ms: float | None = None  # time to the first streamed token (reasoning or content)
    total_ms: float = 0.0


def chat_completion_stream(
    endpoint: LLMEndpointConfig,
    messages: list[dict],
    on_delta: Callable[[str, str], None],
    temperature: float = 0.0,
    max_tokens: int = 1024,
    timeout: float = 60.0,
    sleep_fn: Callable[[float], None] = time.sleep,
    client: httpx.Client | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> StreamedCompletion:
    """POST /chat/completions with ``stream: true`` (server-sent events).

    ``on_delta(kind, text)`` is called per streamed piece, ``kind`` being
    ``"reasoning"`` or ``"content"``. Connection errors and 429/5xx are
    retried with backoff only before the stream starts; a stream that breaks
    midway raises LLMError (a partial answer is never returned).
    """
    if not endpoint.configured():
        raise LLMError("LLM endpoint not configured (LLM_BASE_URL / LLM_MODEL unset)")
    headers = {"Authorization": "Bearer " + endpoint.api_key} if endpoint.api_key else {}
    payload = {
        "model": endpoint.model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    url = f"{endpoint.base_url.rstrip('/')}/chat/completions"

    owns_client = client is None
    client = client or httpx.Client(timeout=timeout)
    try:
        last_error: str | None = None
        status: int | None = None
        for attempt in range(MAX_RETRIES + 1):
            started = clock()
            try:
                with client.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code == 200:
                        return _read_sse(response, on_delta, started, clock)
                    response.read()
                    if response.status_code not in RETRYABLE_STATUS:
                        raise LLMError(
                            f"LLM endpoint returned HTTP {response.status_code}: "
                            f"{response.text[:200]}",
                            status=response.status_code,
                        )
                    last_error = f"HTTP {response.status_code}"
                    status = response.status_code
            except httpx.HTTPError as exc:
                last_error = f"connection error: {exc}"
                status = None
            if attempt < MAX_RETRIES:
                sleep_fn(BACKOFF_SECONDS * (2**attempt))
        raise LLMError(
            f"LLM endpoint failed after {MAX_RETRIES + 1} attempts: {last_error}",
            status=status,
        )
    finally:
        if owns_client:
            client.close()


def _read_sse(
    response: httpx.Response,
    on_delta: Callable[[str, str], None],
    started: float,
    clock: Callable[[], float],
) -> StreamedCompletion:
    result = StreamedCompletion()
    content: list[str] = []
    reasoning: list[str] = []
    try:
        for line in response.iter_lines():
            if not line.startswith("data:"):
                continue  # blank separators and ":" keepalive comments
            data = line[len("data:") :].strip()
            if data == "[DONE]":
                break
            event = json.loads(data)
            if "error" in event:
                raise LLMError(f"LLM stream error: {str(event['error'])[:200]}")
            if event.get("usage"):
                result.usage = event["usage"]
            for choice in event.get("choices") or []:
                delta = choice.get("delta") or {}
                for kind, text in (
                    ("reasoning", delta.get("reasoning_content") or delta.get("reasoning")),
                    ("content", delta.get("content")),
                ):
                    if not text:
                        continue
                    if result.ttft_ms is None:
                        result.ttft_ms = round((clock() - started) * 1000, 1)
                    (reasoning if kind == "reasoning" else content).append(text)
                    on_delta(kind, text)
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        raise LLMError(f"LLM stream broke midway: {exc}") from exc
    result.content = "".join(content)
    result.reasoning = "".join(reasoning)
    result.total_ms = round((clock() - started) * 1000, 1)
    return result


def make_completion(endpoint: LLMEndpointConfig) -> Callable[[str, str], str]:
    """Build a ``complete(system, user) -> str`` function for the gloss pass."""

    def complete(system: str, user: str) -> str:
        body = chat_completion(
            endpoint,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=256,
        )
        return body["choices"][0]["message"]["content"] or ""

    return complete
