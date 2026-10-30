"""Shared test fixtures: the tiny collection and a stub LLM."""

from __future__ import annotations

from pathlib import Path

import pytest

FIXTURE_COLLECTION = Path(__file__).parent / "fixtures" / "collection"

STAND_DATE = "2026-07-23"


class StubLLM:
    """Records calls and returns scripted responses."""

    def __init__(self, responses: list[str] | None = None):
        self.calls: list[dict] = []
        self.responses = list(responses or [])
        self._i = 0

    def __call__(self, messages: list[dict], **kwargs) -> dict:
        self.calls.append({"messages": messages, **kwargs})
        content = self.responses[min(self._i, len(self.responses) - 1)]
        self._i += 1
        return {"choices": [{"message": {"content": content}}]}


@pytest.fixture
def fixture_collection() -> Path:
    return FIXTURE_COLLECTION


@pytest.fixture
def fixture_paragraphs() -> dict[str, dict]:
    from retrieval.base import load_paragraphs

    return load_paragraphs(FIXTURE_COLLECTION)
