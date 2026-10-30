"""Abuse and quota protection.

Per-IP rate limit (slowapi, default 10 queries/hour), a daily token budget
counter persisted across restarts with an alert log line at 80%, and an
asyncio semaphore (default 3) in front of the LLM endpoint. Friendly 429
responses; never a raw traceback.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

ALERT_THRESHOLD = 0.8
STATE_FILENAME = "token_budget_state.json"
SECONDS_PER_DAY = 86_400


class RateLimiter:
    """Fixed-window per-IP rate limiter (in-process; single-process app)."""

    def __init__(self, max_per_hour: int):
        self.max_per_hour = max_per_hour
        self._hits: dict[str, list[float]] = {}

    def allow(self, ip: str, now: float | None = None) -> bool:
        now = now if now is not None else time.time()
        window_start = now - 3600
        hits = [t for t in self._hits.get(ip, []) if t > window_start]
        if len(hits) >= self.max_per_hour:
            self._hits[ip] = hits
            return False
        hits.append(now)
        self._hits[ip] = hits
        return True

    def retry_after(self, ip: str, now: float | None = None) -> int:
        now = now if now is not None else time.time()
        hits = [t for t in self._hits.get(ip, []) if t > now - 3600]
        if not hits:
            return 0
        return max(1, int(hits[0] + 3600 - now))


class TokenBudget:
    """Daily token budget persisted across restarts.

    Splits the endpoint's daily budget between the demo allowance and the
    reserved eval/ingest quota; ``demo_budget`` is what /ask may spend.
    """

    def __init__(self, demo_budget: int, state_path: Path):
        self.demo_budget = demo_budget
        self.state_path = state_path
        self._load()

    def _load(self) -> None:
        try:
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            state = {}
        self._day = state.get("day", "")
        self._spent = int(state.get("spent", 0))

    def _today(self, now: float | None = None) -> str:
        return time.strftime("%Y-%m-%d", time.gmtime(now))

    def _persist(self) -> None:
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            self.state_path.write_text(
                json.dumps({"day": self._day, "spent": self._spent}),
                encoding="utf-8",
            )
        except OSError:
            logger.warning("token budget state not persistable at %s", self.state_path)

    def spent_today(self, now: float | None = None) -> int:
        if self._day != self._today(now):
            return 0
        return self._spent

    def can_spend(self, tokens: int, now: float | None = None) -> bool:
        return self.spent_today(now) + tokens <= self.demo_budget

    def record(self, tokens: int, now: float | None = None) -> None:
        today = self._today(now)
        if self._day != today:
            self._day = today
            self._spent = 0
        self._spent += tokens
        self._persist()
        if self._spent >= ALERT_THRESHOLD * self.demo_budget:
            logger.warning(
                "token budget at %.0f%% (%d of %d)",
                100 * self._spent / self.demo_budget,
                self._spent,
                self.demo_budget,
            )

    def reset_time(self, now: float | None = None) -> str:
        """UTC time the daily budget resets, for the 429 response."""
        now = now if now is not None else time.time()
        midnight = ((now // SECONDS_PER_DAY) + 1) * SECONDS_PER_DAY
        return time.strftime("%Y-%m-%dT00:00:00Z", time.gmtime(midnight))


class LLMSemaphore:
    """Concurrency cap in front of the LLM endpoint, with a visible queue wait."""

    def __init__(self, max_concurrent: int):
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self.max_concurrent = max_concurrent

    async def acquire(self, timeout: float = 30.0) -> None:
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=timeout)
        except TimeoutError:
            raise ConcurrencyFullError(self.max_concurrent) from None

    def release(self) -> None:
        self._semaphore.release()


class ConcurrencyFullError(Exception):
    def __init__(self, max_concurrent: int):
        super().__init__(f"LLM concurrency cap ({max_concurrent}) is full")
        self.max_concurrent = max_concurrent
