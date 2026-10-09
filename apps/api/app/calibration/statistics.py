"""Pure statistics for a calibration run: no I/O, no DB, 100% unit-testable.
Stdlib only -- statistics.correlation (Pearson, 3.10+) on rank-transformed
values gives Spearman's rho without a scipy/numpy dependency.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class SectionScorePair:
    section_key: str
    ai_score: float
    human_score: float


@dataclass(frozen=True)
class ResolvedCalibrationPair:
    submission_id: UUID
    section_scores: list[SectionScorePair]

    @property
    def ai_total(self) -> float:
        return sum(s.ai_score for s in self.section_scores)

    @property
    def human_total(self) -> float:
        return sum(s.human_score for s in self.section_scores)


def mean_absolute_error(ai_totals: list[float], human_totals: list[float]) -> float:
    if len(ai_totals) != len(human_totals):
        raise ValueError("ai_totals and human_totals must be the same length")
    if not ai_totals:
        raise ValueError("need at least one pair to compute a mean absolute error")
    return sum(abs(a - h) for a, h in zip(ai_totals, human_totals, strict=True)) / len(ai_totals)


def section_agreement_pct(pairs: list[ResolvedCalibrationPair], tolerance: float = 1.0) -> float:
    """Percentage of (submission, section) data points where |ai - human|
    is within `tolerance` marks. Named criterion_agreement_pct on the
    calibration_runs row for schema continuity, but the data collected is
    per-SECTION (the admin page enters one human score per section, not
    per individual criterion), so that's the granularity this computes."""
    agreements = 0
    total = 0
    for pair in pairs:
        for section in pair.section_scores:
            total += 1
            if abs(section.ai_score - section.human_score) <= tolerance:
                agreements += 1
    if total == 0:
        raise ValueError("no section scores to compute agreement over")
    return agreements / total * 100


def _average_ranks(values: list[float]) -> list[float]:
    """1-based ranks with ties resolved to the average rank of the tied group."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        average_rank = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = average_rank
        i = j + 1
    return ranks


def spearman_rank_correlation(x: list[float], y: list[float]) -> float:
    if len(x) != len(y):
        raise ValueError("x and y must be the same length")
    if len(x) < 2:
        return 1.0
    try:
        return statistics.correlation(_average_ranks(x), _average_ranks(y))
    except (statistics.StatisticsError, ValueError):
        return 1.0

