"""Rotates across multiple Groq API keys when the active one hits its daily
token quota (TPD), so one account's daily cap doesn't stop evaluation for
the rest of the day -- the project supports a second key (GROQ_API_KEY_2)
precisely because Groq's daily quota is tracked per key, not per project.

Deliberately does NOT rotate on a per-minute limit (TPM/ITPM/RPM): those
recover in under a minute on their own, and post_with_backoff's existing
retry/backoff already handles them correctly. Rotating for those would
just shift load around for no benefit.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from app.config import get_settings

logger = logging.getLogger("hackeval.llm.key_pool")


class GroqKeyPool:
    """A small ordered list of API keys with a current index. `current` is
    read fresh on every request (including mid-retry); `mark_exhausted`
    advances past a key for the rest of the process's life once it's known
    to be out of daily quota -- there's no reliable way to know Groq's exact
    reset time, so a rotated-past key is never retried within this process."""

    def __init__(self, keys: list[str]) -> None:
        # Preserve order, drop blanks, dedupe (a key listed twice is still
        # one account's quota).
        self._keys: list[str] = []
        for key in keys:
            if key and key not in self._keys:
                self._keys.append(key)
        self._index = 0

    @property
    def current(self) -> str:
        if not self._keys:
            return ""
        return self._keys[self._index]

    def mark_exhausted(self, key: str) -> bool:
        """Rotates past `key` if it's the one currently active and another
        key exists. Returns True if rotation happened (caller should retry
        immediately with the new `current`), False if there's nothing left
        to rotate to (caller falls through to normal backoff/failure)."""
        if not self._keys or key != self.current:
            return False  # already rotated past this key by another caller
        if self._index + 1 >= len(self._keys):
            return False  # no further key to try
        self._index += 1
        logger.warning(
            "Groq key exhausted its daily quota; rotating to key %d/%d",
            self._index + 1,
            len(self._keys),
        )
        return True

    def __len__(self) -> int:
        return len(self._keys)


@lru_cache
def get_key_pool() -> GroqKeyPool:
    settings = get_settings()
    return GroqKeyPool([settings.groq_api_key, settings.groq_api_key_2, settings.groq_api_key_3])
