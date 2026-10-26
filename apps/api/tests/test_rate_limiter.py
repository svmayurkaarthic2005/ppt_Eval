import time

import pytest

from app.llm.rate_limiter import (
    BucketCapacityExceededError,
    GroqRateLimiter,
    TokenBucket,
    get_rate_limiter_for_key,
)


async def test_token_bucket_allows_immediate_acquire_within_capacity():
    bucket = TokenBucket(capacity=10, refill_per_second=1)
    start = time.monotonic()
    await bucket.acquire(5)
    assert time.monotonic() - start < 0.05


async def test_token_bucket_waits_for_refill_when_empty():
    bucket = TokenBucket(capacity=1, refill_per_second=10)  # refills 1 token every 0.1s
    await bucket.acquire(1)  # drain it

    start = time.monotonic()
    await bucket.acquire(1)
    elapsed = time.monotonic() - start
    assert elapsed >= 0.08  # allow a little scheduling slack below the 0.1s refill


async def test_token_bucket_rejects_a_request_larger_than_capacity():
    bucket = TokenBucket(capacity=10, refill_per_second=1)
    with pytest.raises(BucketCapacityExceededError):
        await bucket.acquire(11)


async def test_groq_rate_limiter_blocks_on_the_tightest_bucket():
    limiter = GroqRateLimiter(
        requests_per_minute=10_000,
        requests_per_day=10_000,
        tokens_per_minute=600,  # refills at 10 tokens/sec
        tokens_per_day=10_000_000,
    )
    await limiter.acquire(590)  # leaves 10 tokens in the tokens-per-minute bucket

    start = time.monotonic()
    await limiter.acquire(15)  # needs 5 more tokens at 10/s -> ~0.5s wait
    assert time.monotonic() - start >= 0.3


def test_get_rate_limiter_for_key_gives_distinct_limiters_per_key():
    """A key GroqKeyPool just rotated to has its own, untouched daily/per-
    minute budget on Groq's side -- it must not inherit the old key's
    already-drained bucket state."""
    limiter_a = get_rate_limiter_for_key("key-a")
    limiter_b = get_rate_limiter_for_key("key-b")
    assert limiter_a is not limiter_b


def test_get_rate_limiter_for_key_reuses_the_same_limiter_for_the_same_key():
    assert get_rate_limiter_for_key("key-c") is get_rate_limiter_for_key("key-c")


def test_get_rate_limiter_for_key_falls_back_to_shared_limiter_for_empty_key():
    from app.llm.rate_limiter import default_rate_limiter

    assert get_rate_limiter_for_key("") is default_rate_limiter
