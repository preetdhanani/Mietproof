"""Follow-up detection and query rewriting.

A query is a follow-up when a session exists and the query is short (under
8 words) or contains pronouns, demonstratives, or elliptical fragments -
then it is rewritten via the rewrite prompt against the session's last 3
exchanges before retrieval. The heuristic keeps the token budget
predictable: non-follow-ups never pay for a rewrite call.
"""

from __future__ import annotations

import re

from app.config import LLMEndpointConfig
from app.llm import chat_completion

# Pronouns / demonstratives / elliptical openers that signal a follow-up.
_FOLLOW_UP_MARKERS = (
    " it ",
    " that ",
    " this ",
    " there ",
    " they ",
    " them ",
    " he ",
    " she ",
    " those ",
    " these ",
    " also ",
    " and what ",
    " what about ",
    " how about ",
    " and the ",
    " and my ",
    " too?",
    " as well",
)

_WORD_PATTERN = re.compile(r"\S+")


def is_follow_up(query: str, session_exists: bool) -> bool:
    """Heuristic follow-up detection; requires an existing session."""
    if not session_exists:
        return False
    if len(_WORD_PATTERN.findall(query)) < 8:
        return True
    padded = f" {query.lower().strip()} "
    return any(marker in padded for marker in _FOLLOW_UP_MARKERS)


def rewrite_query(
    query: str,
    history: list[dict],
    endpoint: LLMEndpointConfig,
    system_prompt: str,
) -> str:
    """Rewrite a follow-up into a standalone retrieval query via the LLM."""
    transcript = "\n".join(f"{exchange['role']}: {exchange['content']}" for exchange in history)
    body = chat_completion(
        endpoint,
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": f"Conversation so far:\n{transcript}\n\n"
                f"New user message: {query}\n\nStandalone query:",
            },
        ],
        max_tokens=128,
    )
    rewritten = (body["choices"][0]["message"]["content"] or "").strip()
    return rewritten or query
