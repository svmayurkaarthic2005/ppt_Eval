from uuid import uuid4

import pytest

from app.comparison import (
    CACHE_TTL_SECONDS,
    MAX_SUBMISSIONS,
    MIN_SUBMISSIONS,
    _cache,
    _get_cached,
    _set_cached,
    invalidate_for_submission,
    parse_and_dedupe_ids,
    validate_count,
)


@pytest.fixture(autouse=True)
def clear_cache():
    _cache.clear()
    yield
    _cache.clear()


def test_parse_and_dedupe_ids_preserves_order():
    a, b, c = uuid4(), uuid4(), uuid4()
    raw = f"{a}, {b}, {c}"
    assert parse_and_dedupe_ids(raw) == [a, b, c]


def test_parse_and_dedupe_ids_collapses_duplicates():
    a, b = uuid4(), uuid4()
    raw = f"{a},{b},{a}"
    result = parse_and_dedupe_ids(raw)
    assert result == [a, b]


def test_parse_and_dedupe_ids_ignores_blank_segments():
    a, b = uuid4(), uuid4()
    raw = f"{a},,{b},"
    assert parse_and_dedupe_ids(raw) == [a, b]


def test_parse_and_dedupe_ids_rejects_malformed_uuid():
    with pytest.raises(ValueError):
        parse_and_dedupe_ids("not-a-uuid,also-bad")


def test_validate_count_accepts_boundary_values():
    validate_count([uuid4() for _ in range(MIN_SUBMISSIONS)])
    validate_count([uuid4() for _ in range(MAX_SUBMISSIONS)])


def test_validate_count_rejects_too_few():
    with pytest.raises(ValueError):
        validate_count([uuid4()])


def test_validate_count_rejects_too_many():
    with pytest.raises(ValueError):
        validate_count([uuid4() for _ in range(MAX_SUBMISSIONS + 1)])


def test_validate_count_rejects_empty():
    with pytest.raises(ValueError):
        validate_count([])


def test_cache_round_trips_within_ttl():
    ids = [uuid4(), uuid4()]
    _set_cached(ids, {"ok": True})
    assert _get_cached(ids) == {"ok": True}


def test_cache_is_keyed_by_id_set_not_order():
    ids_a = [uuid4(), uuid4()]
    ids_b = list(reversed(ids_a))
    _set_cached(ids_a, {"ok": True})
    assert _get_cached(ids_b) == {"ok": True}


def test_cache_miss_for_different_id_set():
    _set_cached([uuid4(), uuid4()], {"ok": True})
    assert _get_cached([uuid4(), uuid4()]) is None


def test_cache_expires_after_ttl(monkeypatch):
    import time

    ids = [uuid4(), uuid4()]
    _set_cached(ids, {"ok": True})

    real_monotonic = time.monotonic
    monkeypatch.setattr(time, "monotonic", lambda: real_monotonic() + CACHE_TTL_SECONDS + 1)
    assert _get_cached(ids) is None


def test_invalidate_for_submission_drops_only_entries_containing_it():
    s1, s2, s3 = uuid4(), uuid4(), uuid4()
    _set_cached([s1, s2], {"pair": "1-2"})
    _set_cached([s2, s3], {"pair": "2-3"})
    _set_cached([s1, s3], {"pair": "1-3"})

    invalidate_for_submission(s1)

    assert _get_cached([s1, s2]) is None
    assert _get_cached([s1, s3]) is None
    assert _get_cached([s2, s3]) == {"pair": "2-3"}
