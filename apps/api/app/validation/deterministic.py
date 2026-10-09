"""Phase 7 (the pipeline's "validate" stage): all arithmetic here is plain
Python, never the LLM. Every function above the `_and_flag_*` wrappers is
pure -- no I/O, no LLM calls -- so the whole module is unit-testable
without a database or network connection. See tests/test_deterministic.py.

Money uses decimal.Decimal throughout, never float, to avoid the rounding
bugs float introduces on currency (Phase 3's table cells carry a float
`value` for general numeric display, but this module re-parses the
original cell text through Decimal instead of trusting that float).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal
from uuid import UUID

import asyncpg

_CURRENCY_CHARS = "$€£¥₹"
_DEFAULT_TOTAL_KEYWORDS = ("grand total", "subtotal", "total")

_TOTAL_PATTERN = re.compile(
    r"(?:grand\s+total|total\s+cost|subtotal|total)\s*[:\-]?\s*[₹$€£]?\s*([\d,]+(?:\.\d+)?)",
    re.IGNORECASE,
)

_DECREASE_WORDS = ("reduction", "reduce", "decrease", "drop", "cut", "decline", "fall", "lower")
_INCREASE_WORDS = ("increase", "improvement", "improve", "growth", "rise", "gain", "boost", "higher")

_PERCENT_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*%")


class ScoreOutOfBoundsError(ValueError):
    pass


class SectionRowCountExceededError(ValueError):
    pass


def parse_currency_decimal(text: str) -> Decimal | None:
    """Strips currency symbols/thousands separators; returns None (never a
    silent 0) for anything that doesn't parse as a number."""
    cleaned = text.strip()
    for char in _CURRENCY_CHARS:
        cleaned = cleaned.replace(char, "")
    cleaned = cleaned.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def sum_cost_line_items(
    table: list[list[dict]],
    amount_column_index: int = -1,
    total_keywords: tuple[str, ...] = _DEFAULT_TOTAL_KEYWORDS,
) -> Decimal:
    """Sums a cost table's line items, skipping any row whose first cell
    looks like a total/subtotal row (so the declared total isn't
    double-counted as if it were itself a line item)."""
    running = Decimal(0)
    for row in table:
        if not row:
            continue
        label = (row[0].get("text") or "").strip().lower()
        if any(keyword in label for keyword in total_keywords):
            continue
        amount_cell = row[amount_column_index]
        value = parse_currency_decimal(amount_cell.get("text", ""))
        if value is not None:
            running += value
    return running


def extract_declared_total(raw_text: str) -> Decimal | None:
    match = _TOTAL_PATTERN.search(raw_text)
    if not match:
        return None
    return parse_currency_decimal(match.group(1))


@dataclass(frozen=True)
class CostValidationResult:
    computed_total: Decimal
    declared_total: Decimal | None
    difference: Decimal | None
    mismatch: bool


def validate_cost_table(
    table: list[list[dict]],
    raw_text: str,
    tolerance: Decimal = Decimal(1),
    amount_column_index: int = -1,
) -> CostValidationResult:
    computed = sum_cost_line_items(table, amount_column_index)
    declared = extract_declared_total(raw_text)
    if declared is None:
        return CostValidationResult(
            computed_total=computed, declared_total=None, difference=None, mismatch=False
        )
    difference = (computed - declared).copy_abs()
    return CostValidationResult(
        computed_total=computed,
        declared_total=declared,
        difference=difference,
        mismatch=difference > tolerance,
    )


@dataclass(frozen=True)
class PercentageClaim:
    raw_text: str
    percentage: Decimal  # always a positive magnitude
    direction: Literal["increase", "decrease"]


def _direction_and_word_nearby(window: str) -> tuple[Literal["increase", "decrease"], str] | None:
    lowered = window.lower()
    for word in _DECREASE_WORDS:
        if word in lowered:
            return "decrease", word
    for word in _INCREASE_WORDS:
        if word in lowered:
            return "increase", word
    return None


def extract_percentage_claims(text: str, window_chars: int = 40) -> list[PercentageClaim]:
    """A lightweight regex pass, not a full NER model: finds every 'NN%'
    and looks for a direction keyword (reduction/increase/...) within
    `window_chars` on either side -- enough to catch both 'a 40% cost
    reduction' and 'reduced costs by 40%' phrasing."""
    claims: list[PercentageClaim] = []
    for match in _PERCENT_PATTERN.finditer(text):
        start, end = match.span()
        window = text[max(0, start - window_chars) : end + window_chars]
        found = _direction_and_word_nearby(window)
        if found is not None:
            direction, word = found
            claims.append(
                PercentageClaim(
                    raw_text=f"{match.group(0)} {word}",
                    percentage=Decimal(match.group(1)),
                    direction=direction,
                )
            )
    return claims


def compute_percentage_change(before: Decimal, after: Decimal) -> Decimal:
    if before == 0:
        raise ValueError("cannot compute a percentage change from a zero baseline")
    return ((after - before) / before) * Decimal(100)


@dataclass(frozen=True)
class ClaimValidationResult:
    claimed_percentage: Decimal
    claimed_direction: Literal["increase", "decrease"]
    actual_percentage_change: Decimal
    mismatch: bool
    reason: str | None


def validate_numeric_claim(
    claim: PercentageClaim,
    before: Decimal,
    after: Decimal,
    tolerance_pct: Decimal = Decimal(5),
) -> ClaimValidationResult:
    actual = compute_percentage_change(before, after)

    if actual == 0:
        # Neither an increase nor a decrease -- call it out as "no change"
        # rather than defaulting to "decrease" (which `actual > 0` would
        # otherwise silently do for a flat metric).
        mismatch = claim.percentage > tolerance_pct
        reason = (
            None
            if not mismatch
            else f"claimed {claim.percentage}% {claim.direction}, chart data shows no change"
        )
        return ClaimValidationResult(
            claimed_percentage=claim.percentage,
            claimed_direction=claim.direction,
            actual_percentage_change=actual,
            mismatch=mismatch,
            reason=reason,
        )

    actual_direction: Literal["increase", "decrease"] = "increase" if actual > 0 else "decrease"

    if actual_direction != claim.direction:
        return ClaimValidationResult(
            claimed_percentage=claim.percentage,
            claimed_direction=claim.direction,
            actual_percentage_change=actual,
            mismatch=True,
            reason=f"claimed a {claim.direction} but the chart data shows a {actual_direction}",
        )

    difference = (actual.copy_abs() - claim.percentage).copy_abs()
    mismatch = difference > tolerance_pct
    reason = (
        None
        if not mismatch
        else f"claimed {claim.percentage}% {claim.direction}, chart data implies {actual.copy_abs()}%"
    )
    return ClaimValidationResult(
        claimed_percentage=claim.percentage,
        claimed_direction=claim.direction,
        actual_percentage_change=actual,
        mismatch=mismatch,
        reason=reason,
    )


def check_score_bounds(llm_score: int, max_score: int) -> None:
    """Mirrors the DB CHECK constraint on criterion_scores (belt-and-suspenders:
    the database enforces this regardless, but failing fast in application
    code with a clearer message is cheap)."""
    if not 0 <= llm_score <= max_score:
        raise ScoreOutOfBoundsError(f"llm_score {llm_score} is outside [0, {max_score}]")


def check_section_row_count(existing_row_count: int, max_criteria_for_section: int) -> None:
    """Mirrors the trg_enforce_section_criterion_count DB trigger
    (supabase/migrations/20260101000900_validation.sql): a section can never
    end up with more criterion_scores rows than its template defines, which
    is what an accidentally-retried-and-reinserted LLM call would cause."""
    if existing_row_count + 1 > max_criteria_for_section:
        raise SectionRowCountExceededError(
            f"adding one more row would make {existing_row_count + 1}, exceeding the "
            f"{max_criteria_for_section} defined criteria for this section"
        )


async def validate_and_flag_cost_table(
    conn: asyncpg.Connection,
    submission_id: UUID,
    slide_number: int,
    table: list[list[dict]],
    raw_text: str,
    tolerance: Decimal = Decimal(1),
) -> CostValidationResult:
    result = validate_cost_table(table, raw_text, tolerance)
    if result.mismatch:
        await conn.execute(
            """
            insert into consistency_flags (submission_id, flag_type, severity, description)
            values ($1, 'cost_mismatch', 'high', $2)
            """,
            submission_id,
            f"Slide {slide_number}: computed total {result.computed_total} does not match "
            f"the declared total {result.declared_total} (difference {result.difference}).",
        )
    return result


async def validate_and_flag_numeric_claim(
    conn: asyncpg.Connection,
    submission_id: UUID,
    slide_number: int,
    claim: PercentageClaim,
    before: Decimal,
    after: Decimal,
    tolerance_pct: Decimal = Decimal(5),
) -> ClaimValidationResult:
    result = validate_numeric_claim(claim, before, after, tolerance_pct)
    if result.mismatch:
        await conn.execute(
            """
            insert into consistency_flags (submission_id, flag_type, severity, description)
            values ($1, 'claim_data_inconsistency', 'medium', $2)
            """,
            submission_id,
            f"Slide {slide_number}: claim '{claim.raw_text}' -- {result.reason}.",
        )
    return result
