"""Guardrails: rate limit trips correctly, token budget exhaustion returns
the friendly 429, semaphore bounds concurrency."""

from __future__ import annotations

import asyncio

from app.guardrails import (
    ConcurrencyFullError,
    LLMSemaphore,
    RateLimiter,
    TokenBudget,
)


class TestRateLimiter:
    def test_allows_within_limit(self) -> None:
        limiter = RateLimiter(max_per_hour=3)
        now = 1000.0
        assert limiter.allow("ip1", now)
        assert limiter.allow("ip1", now)
        assert limiter.allow("ip1", now)

    def test_trips_at_limit(self) -> None:
        limiter = RateLimiter(max_per_hour=3)
        now = 1000.0
        for _ in range(3):
            assert limiter.allow("ip1", now)
        assert not limiter.allow("ip1", now)

    def test_per_ip_isolation(self) -> None:
        limiter = RateLimiter(max_per_hour=1)
        now = 1000.0
        assert limiter.allow("ip1", now)
        assert not limiter.allow("ip1", now)
        assert limiter.allow("ip2", now)

    def test_window_slides(self) -> None:
        limiter = RateLimiter(max_per_hour=1)
        assert limiter.allow("ip1", 1000.0)
        assert not limiter.allow("ip1", 2000.0)
        assert limiter.allow("ip1", 1000.0 + 3601)

    def test_retry_after(self) -> None:
        limiter = RateLimiter(max_per_hour=1)
        now = 1000.0
        limiter.allow("ip1", now)
        limiter.allow("ip1", now)  # blocked
        retry = limiter.retry_after("ip1", now)
        assert 0 < retry <= 3600


class TestTokenBudget:
    def test_exhaustion_detected(self, tmp_path) -> None:
        budget = TokenBudget(demo_budget=100, state_path=tmp_path / "state.json")
        assert budget.can_spend(100, now=1000.0)
        assert not budget.can_spend(101, now=1000.0)

    def test_record_accumulates_and_persists(self, tmp_path) -> None:
        path = tmp_path / "state.json"
        budget = TokenBudget(demo_budget=100, state_path=path)
        budget.record(60, now=1000.0)
        assert budget.spent_today(now=1000.0) == 60
        # A new instance (restart) reads persisted state.
        reloaded = TokenBudget(demo_budget=100, state_path=path)
        assert reloaded.spent_today(now=1000.0) == 60

    def test_daily_reset(self, tmp_path) -> None:
        budget = TokenBudget(demo_budget=100, state_path=tmp_path / "state.json")
        budget.record(100, now=1000.0)  # exhausted
        next_day = 1000.0 + 86_400
        assert budget.spent_today(now=next_day) == 0
        assert budget.can_spend(10, now=next_day)

    def test_alert_logged_at_80_percent(self, tmp_path, caplog) -> None:
        budget = TokenBudget(demo_budget=100, state_path=tmp_path / "state.json")
        with caplog.at_level("WARNING"):
            budget.record(80, now=1000.0)
        assert any("token budget" in r.message for r in caplog.records)

    def test_reset_time_is_next_utc_midnight(self, tmp_path) -> None:
        budget = TokenBudget(demo_budget=100, state_path=tmp_path / "state.json")
        # 2026-01-15 12:00:00 UTC = 1768478400
        reset = budget.reset_time(now=1768478400)
        assert reset == "2026-01-16T00:00:00Z"


class TestLLMSemaphore:
    def test_bounds_concurrency(self) -> None:
        semaphore = LLMSemaphore(max_concurrent=2)
        active = 0
        peak = 0

        async def task():
            nonlocal active, peak
            await semaphore.acquire(timeout=1.0)
            nonlocal_active_bump = 1
            active += nonlocal_active_bump
            peak = max(peak, active)
            await asyncio.sleep(0.05)
            active -= 1
            semaphore.release()

        async def main():
            await asyncio.gather(*(task() for _ in range(6)))

        asyncio.run(main())
        assert peak <= 2

    def test_timeout_raises_friendly_error(self) -> None:
        async def main():
            semaphore = LLMSemaphore(max_concurrent=1)
            await semaphore.acquire(timeout=1.0)
            try:
                await semaphore.acquire(timeout=0.05)
                raise AssertionError("should have timed out")
            except ConcurrencyFullError as exc:
                assert "concurrency cap" in str(exc)
            finally:
                semaphore.release()

        asyncio.run(main())
