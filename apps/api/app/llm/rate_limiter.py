"""Token-bucket rate limiting against Groq's documented free-tier limits:
~30 req/min, 1000 req/day, 8K tokens/min, 200K tokens/day. Phase 12 needs
this to process 100+ submissions without silently dropping requests --
each bucket just makes the caller wait for capacity rather than failing.

Buckets are in-process only (not persisted across a restart): the goal is
smoothing a long batch run within one process, not exact cross-restart
accounting of a free-tier quota.
"""

from __future__ import annotations

import asyncio
import time


class BucketCapacityExceededError(Exception):
    """Raised when a single request asks for more than the bucket could
    ever hold -- waiting would block forever, so this fails fast instead."""


class TokenBucket:
    def __init__(self, capacity: float, refill_per_second: float):
        self.capacity = capacity
        self.refill_per_second = refill_per_second
        self._tokens = capacity
        self._updated_at = time.monotonic()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._updated_at
        self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_per_second)
        self._updated_at = now

    async def acquire(self, amount: float) -> None:
        if amount > self.capacity:
            raise BucketCapacityExceededError(
                f"requested {amount} exceeds bucket capacity {self.capacity}"
            )
        while True:
            async with self._lock:
                self._refill()
                if self._tokens >= amount:
                    self._tokens -= amount
                    return
                wait_seconds = (amount - self._tokens) / self.refill_per_second
            await asyncio.sleep(wait_seconds)


class GroqRateLimiter:
    def __init__(
        self,
        requests_per_minute: float = 30,
        requests_per_day: float = 1000,
        tokens_per_minute: float = 30_000,
        tokens_per_day: float = 500_000,
    ):
        self.requests_per_minute = TokenBucket(requests_per_minute, requests_per_minute / 60)
        self.requests_per_day = TokenBucket(requests_per_day, requests_per_day / 86_400)
        self.tokens_per_minute = TokenBucket(tokens_per_minute, tokens_per_minute / 60)
        self.tokens_per_day = TokenBucket(tokens_per_day, tokens_per_day / 86_400)

    async def acquire(self, estimated_tokens: int) -> None:
        await asyncio.gather(
            self.requests_per_minute.acquire(1),
            self.requests_per_day.acquire(1),
            self.tokens_per_minute.acquire(estimated_tokens),
            self.tokens_per_day.acquire(estimated_tokens),
        )


# One shared limiter per process: Groq's limits are per-API-key, not per-call-site.
default_rate_limiter = GroqRateLimiter()

_limiters_by_key: dict[str, GroqRateLimiter] = {}


def get_rate_limiter_for_key(api_key: str) -> GroqRateLimiter:
    """A key rotated to by GroqKeyPool has its own, separate daily/per-minute
    budget on Groq's side -- reusing default_rate_limiter's bucket after a
    rotation would make the new key look as throttled as the exhausted one
    it replaced, for no reason. Falls back to the shared limiter when no key
    is given (keeps existing single-key callers' behavior unchanged)."""
    if not api_key:
        return default_rate_limiter
    if api_key not in _limiters_by_key:
        _limiters_by_key[api_key] = GroqRateLimiter()
    return _limiters_by_key[api_key]
