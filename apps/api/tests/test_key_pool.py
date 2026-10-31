from app.llm.key_pool import GroqKeyPool


def test_current_returns_empty_string_for_an_empty_pool():
    pool = GroqKeyPool([])
    assert pool.current == ""
    assert len(pool) == 0


def test_current_returns_the_first_key_initially():
    pool = GroqKeyPool(["key-a", "key-b"])
    assert pool.current == "key-a"


def test_blank_keys_are_dropped():
    pool = GroqKeyPool(["", "key-a", ""])
    assert len(pool) == 1
    assert pool.current == "key-a"


def test_duplicate_keys_are_deduped():
    pool = GroqKeyPool(["key-a", "key-a", "key-b"])
    assert len(pool) == 2


def test_mark_exhausted_rotates_to_the_next_key():
    pool = GroqKeyPool(["key-a", "key-b"])
    rotated = pool.mark_exhausted("key-a")
    assert rotated is True
    assert pool.current == "key-b"


def test_mark_exhausted_returns_false_when_no_other_key_exists():
    pool = GroqKeyPool(["key-a"])
    rotated = pool.mark_exhausted("key-a")
    assert rotated is False
    assert pool.current == "key-a"


def test_mark_exhausted_returns_false_for_an_empty_pool():
    pool = GroqKeyPool([])
    assert pool.mark_exhausted("anything") is False


def test_mark_exhausted_is_a_noop_when_key_is_not_current():
    """Guards against a race: two concurrent callers both see a 429 on the
    same (already-rotated-past) key and both try to mark it exhausted --
    the second one must not advance the pool a second time."""
    pool = GroqKeyPool(["key-a", "key-b", "key-c"])
    pool.mark_exhausted("key-a")
    assert pool.current == "key-b"
    # A late caller still holding the stale "key-a" tries to mark it again.
    rotated = pool.mark_exhausted("key-a")
    assert rotated is False
    assert pool.current == "key-b"  # unchanged, not skipped to key-c


def test_mark_exhausted_stops_at_the_last_key():
    """With a 2-key pool, once the second key is also exhausted there is
    nothing left to rotate to -- the caller falls through to normal
    backoff/failure handling rather than looping forever."""
    pool = GroqKeyPool(["key-a", "key-b"])
    pool.mark_exhausted("key-a")
    assert pool.mark_exhausted("key-b") is False
    assert pool.current == "key-b"


def test_get_key_pool_reads_all_three_configured_keys(monkeypatch):
    import app.llm.key_pool as key_pool_module

    class _FakeSettings:
        groq_api_key = "key-1"
        groq_api_key_2 = "key-2"
        groq_api_key_3 = "key-3"

    key_pool_module.get_key_pool.cache_clear()
    monkeypatch.setattr(key_pool_module, "get_settings", lambda: _FakeSettings())

    pool = key_pool_module.get_key_pool()

    assert len(pool) == 3
    assert pool.current == "key-1"
    key_pool_module.get_key_pool.cache_clear()


def test_mark_throttled_switches_to_next_available_key():
    pool = GroqKeyPool(["key-a", "key-b", "key-c"])
    assert pool.current == "key-a"
    rotated = pool.mark_throttled("key-a", wait_seconds=5.0)
    assert rotated is True
    assert pool.current == "key-b"
    # When key-b is also throttled, rotates to key-c
    rotated2 = pool.mark_throttled("key-b", wait_seconds=5.0)
    assert rotated2 is True
    assert pool.current == "key-c"
    # When all are throttled, mark_throttled returns False
    rotated3 = pool.mark_throttled("key-c", wait_seconds=5.0)
    assert rotated3 is False


def test_advance_round_robin_distributes_across_usable_keys():
    pool = GroqKeyPool(["key-a", "key-b", "key-c"])
    assert pool.current == "key-a"
    pool.advance_round_robin()
    assert pool.current == "key-b"
    pool.advance_round_robin()
    assert pool.current == "key-c"
    pool.advance_round_robin()
    assert pool.current == "key-a"

