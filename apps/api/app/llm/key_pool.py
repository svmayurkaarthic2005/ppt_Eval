"""Rotates across multiple Groq API keys when the active one hits rate limits
(TPM/RPM) or daily token quota (TPD), so one account's limits don't stop
evaluation or cause submissions to fail with 0 scores.

Supports multiple keys (GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3) with:
- Automatic failover on 429 rate limits (switches to the next key immediately).
- Temporary throttling tracking with cooldowns so a rate-limited key recovers.
- Permanent exhaustion tracking for daily quota or auth errors.
- Round-robin load distribution across active keys to maximize throughput.
"""

from __future__ import annotations

import logging
import time
from functools import lru_cache

from app.config import get_settings

logger = logging.getLogger("hackeval.llm.key_pool")


class GroqKeyPool:
    """An ordered list of API keys that rotates dynamically on rate limits (429)
    or quota exhaustion. Ensures that if any key goes down or hits limits,
    the remaining keys seamlessly take over."""

    def __init__(self, keys: list[str]) -> None:
        self._keys: list[str] = []
        for key in keys:
            if key and key not in self._keys:
                self._keys.append(key)
        self._index = 0
        self._exhausted: set[str] = set()
        self._throttled_until: dict[str, float] = {}

    def _is_usable(self, key: str, now: float) -> bool:
        return key not in self._exhausted and self._throttled_until.get(key, 0.0) <= now

    def _find_best_key_index(self) -> int:
        if not self._keys:
            return 0
        now = time.time()
        # 1. Try finding an unexhausted, unthrottled key starting from current index
        n = len(self._keys)
        for offset in range(n):
            idx = (self._index + offset) % n
            key = self._keys[idx]
            if self._is_usable(key, now):
                return idx

        # 2. If all are throttled/exhausted, find the unexhausted key with earliest cooldown
        best_idx = self._index
        best_time = float("inf")
        for idx, key in enumerate(self._keys):
            if key not in self._exhausted:
                t = self._throttled_until.get(key, 0.0)
                if t < best_time:
                    best_time = t
                    best_idx = idx
        return best_idx

    @property
    def current(self) -> str:
        if not self._keys:
            return ""
        # Keep index aligned to a usable key if possible
        now = time.time()
        if not self._is_usable(self._keys[self._index], now):
            self._index = self._find_best_key_index()
        return self._keys[self._index]

    def advance_round_robin(self) -> None:
        """Gently advances to the next unexhausted key after a successful call
        so load is balanced evenly across all configured keys."""
        if len(self._keys) <= 1:
            return
        now = time.time()
        n = len(self._keys)
        for offset in range(1, n):
            candidate_idx = (self._index + offset) % n
            if self._is_usable(self._keys[candidate_idx], now):
                self._index = candidate_idx
                return

    def mark_throttled(self, key: str, wait_seconds: float = 10.0) -> bool:
        """Marks `key` as temporarily throttled (due to a 429 TPM/RPM rate limit).
        Switches to another available key immediately. Returns True if another
        key is available, or False if all keys are throttled/exhausted."""
        if not self._keys:
            return False
        cooldown = max(2.0, min(wait_seconds, 60.0))
        self._throttled_until[key] = time.time() + cooldown

        now = time.time()
        # Find another key that is usable
        n = len(self._keys)
        for offset in range(1, n):
            candidate_idx = (self._index + offset) % n
            candidate_key = self._keys[candidate_idx]
            if self._is_usable(candidate_key, now):
                self._index = candidate_idx
                logger.warning(
                    "Groq key ...%s throttled for %.1fs; rotated immediately to key %d/%d (...%s)",
                    key[-4:] if len(key) >= 4 else "...",
                    cooldown,
                    self._index + 1,
                    n,
                    candidate_key[-4:] if len(candidate_key) >= 4 else "...",
                )
                return True

        return False

    def mark_exhausted(self, key: str) -> bool:
        """Permanently exhausts `key` for the lifetime of this process
        (due to daily quota TPD/RPD or 401/403 auth error). Returns True if
        another key was available to rotate to."""
        if not self._keys:
            return False
        if key not in self._keys:
            return False
        if key in self._exhausted:
            return False  # already exhausted

        self._exhausted.add(key)
        n = len(self._keys)

        # Check if any unexhausted key exists
        unexhausted_indices = [i for i, k in enumerate(self._keys) if k not in self._exhausted]
        if not unexhausted_indices:
            logger.warning(
                "All %d Groq API keys in pool are exhausted; no remaining keys",
                n,
            )
            return False

        # Pick the next unexhausted index
        for offset in range(1, n):
            candidate_idx = (self._index + offset) % n
            if self._keys[candidate_idx] not in self._exhausted:
                self._index = candidate_idx
                logger.warning(
                    "Groq key ...%s exhausted its quota/auth; rotated to key %d/%d (...%s)",
                    key[-4:] if len(key) >= 4 else "...",
                    self._index + 1,
                    n,
                    self._keys[candidate_idx][-4:] if len(self._keys[candidate_idx]) >= 4 else "...",
                )
                return True

        # Fallback
        self._index = unexhausted_indices[0]
        return True

    def __len__(self) -> int:
        return len(self._keys)


@lru_cache
def get_key_pool() -> GroqKeyPool:
    settings = get_settings()
    return GroqKeyPool([settings.groq_api_key, settings.groq_api_key_2, settings.groq_api_key_3])
