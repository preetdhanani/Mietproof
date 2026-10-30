"""Langfuse tracing integration.

The full span sequence (retrieval, prompt, response, latency, tokens) is
recorded in Langfuse under the ``request_id``. The SDK runs non-blocking so
a tracing outage degrades tracing only. Traces are ephemeral by policy; the
run log in the repo is the durable record.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class NullTracer:
    """No-op tracer used when Langfuse is not configured or unreachable."""

    def trace_request(self, *args: Any, **kwargs: Any) -> None:
        return

    def flush(self) -> None:
        return


class LangfuseTracer:
    """Thin wrapper over the Langfuse SDK; failures degrade to no-ops."""

    def __init__(self, host: str, public_key: str, secret_key: str):
        try:
            from langfuse import Langfuse

            self._client = Langfuse(
                host=host,
                public_key=public_key,
                secret_key=secret_key,
            )
        except Exception as exc:  # noqa: BLE001 - tracing must never break serving
            logger.warning("Langfuse init failed - tracing disabled: %s", exc)
            self._client = None

    def trace_request(
        self,
        request_id: str,
        question: str,
        answer: str,
        behavior: str,
        retrieved: list[dict],
        citations: list[dict],
        latency_ms: int,
        model: str,
        prompt_version: str,
        token_usage: dict | None = None,
    ) -> None:
        if self._client is None:
            return
        try:
            trace = self._client.trace(
                id=f"ask-{request_id}",
                name="ask",
                input={"question": question},
                output={"answer": answer, "behavior": behavior},
                metadata={
                    "request_id": request_id,
                    "behavior": behavior,
                    "latency_ms": latency_ms,
                    "model": model,
                    "prompt_version": prompt_version,
                    "citation_count": len(citations),
                },
            )
            trace.span(
                name="retrieval",
                input={"question": question},
                output={"chunks": [c["paragraph"] for c in retrieved]},
            )
            trace.span(
                name="generation",
                input={"model": model},
                output={"answer": answer},
                usage=token_usage or None,
            )
        except Exception as exc:  # noqa: BLE001 - degrade tracing only
            logger.warning("Langfuse trace failed (non-blocking): %s", exc)

    def flush(self) -> None:
        if self._client is None:
            return
        try:
            self._client.flush()
        except Exception:  # noqa: BLE001
            pass


def build_tracer(settings) -> LangfuseTracer | NullTracer:
    if settings.LANGFUSE_HOST and settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
        return LangfuseTracer(
            settings.LANGFUSE_HOST,
            settings.LANGFUSE_PUBLIC_KEY,
            settings.LANGFUSE_SECRET_KEY,
        )
    logger.info("Langfuse not configured - tracing disabled")
    return NullTracer()
