"""Thin OpenAI-compatible chat-completions client.

Base URL + model come from config. Retries with backoff on 429/5xx.
Deliberately no provider-specific features (no tool calling, no provider
JSON modes) - that keeps the swap surface at the HTTP layer only. This
constraint applies to the generator client only; the RAGAS adapter runs its
own client for the judge, where structured output is required.
"""

from __future__ import annotations

import time
from collections.abc import Callable

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
    headers = {"Authorization": f"Bearer {endpoint.api_key}"} if endpoint.api_key else {}
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
