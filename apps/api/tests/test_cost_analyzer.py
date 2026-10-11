import pytest

from app.models.schemas import SubmissionContext
from app.research.cost_analyzer import (
    CostAnalysis,
    _detect_currency,
    _fallback_cost_analysis,
    generate_cost_analysis,
)


def test_detect_currency():
    assert _detect_currency("Total cost: ₹4,500 for the kit") == "INR"
    assert _detect_currency("Estimated price in Rs. 1500") == "INR"
    assert _detect_currency("Budget in INR 3000") == "INR"
    assert _detect_currency("Total cost: $45 for the prototype") == "INR"
    assert _detect_currency("Device price USD 120") == "INR"


def test_fallback_cost_analysis_extracts_components_and_totals():
    deck_text = (
        "Slide 1: Recycled ABS Compounding & Impact Strength Recovery\n"
        "Slide 2: Proposed Solution: We use core-shell rubber impact modifier additives with twin-screw extrusion, "
        "cyclonic dust filtration, and in-line color sensors.\n"
        "Slide 3: Budget & Cost: Total cost ₹25,000\n"
        "- Impact modifier chemical additive: ₹3,500\n"
        "- Twin-screw compounding extruder rig: ₹15,000\n"
    )
    result = _fallback_cost_analysis(deck_text, "INR")

    assert isinstance(result, CostAnalysis)
    assert result.currency == "INR"
    assert result.total_declared_cost == 25000.0
    assert result.total_estimated_cost > 0
    assert len(result.components) >= 2

    # Check chemical & equipment categories
    categories = {c.category for c in result.components}
    assert "chemicals_reagents" in categories
    assert "equipment_hardware" in categories

    # Omitted components detected (utilities or dust filtration wasn't declared in budget)
    assert any(c.is_declared_by_team is False for c in result.components)

    # All components must have verified product name, cost, source name, and clickable link
    for c in result.components:
        assert c.name and len(c.name) > 3
        assert c.estimated_market_cost > 0
        assert c.source_name and len(c.source_name) > 0
        assert c.source_url.startswith("http://") or c.source_url.startswith("https://")


def test_resolve_source_info():
    from app.research.cost_analyzer import _resolve_source_info

    # Amazon India
    name, url = _resolve_source_info("Particulate Air Filter HEPA", "waste_disposal_compliance", "Amazon", "", "INR")
    assert name == "Amazon India"
    assert "amazon.in" in url
    assert "Particulate+Air+Filter+HEPA" in url

    # Flipkart
    name, url = _resolve_source_info("Industrial Heating Element", "utilities_energy", "Flipkart", "", "INR")
    assert name == "Flipkart"
    assert "flipkart.com" in url

    # IndiaMART
    name, url = _resolve_source_info("ABS Compounding Resin", "chemicals_reagents", "IndiaMART", "", "INR")
    assert name == "IndiaMART"
    assert "indiamart.com" in url

    # Sigma-Aldrich
    name, url = _resolve_source_info("Polymer Catalyst Reagent", "chemicals_reagents", "Sigma-Aldrich", "", "INR")
    assert name == "Sigma-Aldrich"
    assert "sigmaaldrich.com" in url

    # Robu.in
    name, url = _resolve_source_info("Optical Color Sensor TCS34725", "sensors_instrumentation", "Robu", "", "INR")
    assert name == "Robu.in"
    assert "robu.in" in url


@pytest.mark.asyncio
async def test_generate_cost_analysis_fallback_mode():
    context = SubmissionContext(
        problem_domain="Agricultural IoT",
        target_beneficiary="Smallholder Farmers",
        required_deliverables=["Cost breakdown"],
        track_constraints=[],
        is_generic=False,
        generic_reason=None,
    )
    deck_text = (
        "Autonomous drone for crop disease detection. Hardware includes Raspberry Pi 4, "
        "camera module, frame, and batteries. Cloud dashboard runs AI inference."
    )
    result = await generate_cost_analysis(
        context=context,
        problem_statement_text="Low-cost crop health monitoring",
        deck_text=deck_text,
    )
    assert isinstance(result, CostAnalysis)
    assert len(result.components) > 0
    assert result.total_estimated_cost > 0
    assert result.affordability_verdict in [
        "highly_affordable",
        "moderate_realistic",
        "underestimated_missing_components",
        "expensive_high_barrier",
    ]
    # Verify that each component has verified vendor source and clickable URL
    for c in result.components:
        assert c.source_name
        assert c.source_url.startswith("https://") or c.source_url.startswith("http://")
