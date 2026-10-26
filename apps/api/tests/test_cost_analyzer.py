from __future__ import annotations

import pytest

from app.models.schemas import SubmissionContext
from app.research.cost_analyzer import (
    CostAnalysis,
    ProjectComponent,
    _detect_currency,
    _fallback_cost_analysis,
    _reconcile_and_compute_totals,
    _resolve_source_info,
    _sanitize_cost_analysis,
    _software_cost_analysis,
    classify_project_scope,
    generate_cost_analysis,
)


def test_detect_currency():
    assert _detect_currency("Total cost: ₹4,500 for the kit") == "INR"
    assert _detect_currency("Estimated price in Rs. 1500") == "INR"
    assert _detect_currency("Budget in INR 3000") == "INR"
    assert _detect_currency("Total cost: $45 for the prototype") == "INR"
    assert _detect_currency("Device price USD 120") == "INR"


@pytest.mark.parametrize(
    ("domain", "deliverables", "deck_text", "expected_scope"),
    [
        (
            "Agricultural AI Analytics",
            ["Python Web Dashboard", "REST API"],
            "Purely software-based computer vision web app using hosted models. No hardware, sensors, or physical devices are required.",
            "software_only",
        ),
        (
            "Plastic Compounding & Extrusion",
            ["Compounded plastic pellet samples", "Extrusion prototype"],
            "We construct a pilot twin-screw extruder compounding setup using MBS rubber modifiers and hopper feed systems.",
            "physical_only",
        ),
        (
            "Precision Smart Irrigation",
            ["IoT Soil Sensor Probe", "Cloud Analytics Dashboard"],
            "ESP32 microcontrollers wired to capacitive soil moisture sensors transmit data to a Next.js web application.",
            "hybrid",
        ),
        (
            "Crop Health Monitoring",
            ["Software Algorithm"],
            "We propose a deep learning neural network model. While standard drones have cameras and motors, our project is solely the software algorithm and does not build any physical hardware.",
            "software_only",
        ),
    ],
)
def test_classify_project_scope_meaningful_context(
    domain: str, deliverables: list[str], deck_text: str, expected_scope: str
):
    ctx = SubmissionContext(
        problem_domain=domain,
        target_beneficiary="Users",
        required_deliverables=deliverables,
        track_constraints=[],
        is_generic=False,
    )
    scope = classify_project_scope(ctx, "Problem Statement Text", deck_text)
    assert scope == expected_scope


def test_classify_project_scope_insufficient_evidence():
    scope = classify_project_scope(None, "", "Brief overview")
    assert scope in ("uncertain_review_required", "hybrid")


def test_deterministic_arithmetic_line_totals_and_capex_opex():
    components = [
        ProjectComponent(
            name="Industrial Extruder Barrel",
            category="equipment_hardware",
            cost_type="capex",
            quantity=2.0,
            unit="units",
            # Declared cost (31000) deliberately differs from quantity *
            # estimated_market_cost (2 * 15000 = 30000) -- line_total must
            # follow the team's declared figure, not the benchmark.
            estimated_market_cost=15000.0,
            is_declared_by_team=True,
            declared_cost=31000.0,
            price_provenance="indicative_estimate",
            currency="INR",
            source_name="IndiaMART",
            source_url="https://dir.indiamart.com/search.mp?ss=extruder",
            notes="Pilot barrel",
        ),
        ProjectComponent(
            name="MBS Rubber Modifier",
            category="chemicals_reagents",
            cost_type="opex",
            quantity=5.0,
            unit="kg",
            estimated_market_cost=800.0,
            is_declared_by_team=False,
            declared_cost=None,
            price_provenance="indicative_estimate",
            currency="INR",
            source_name="Sigma-Aldrich",
            source_url="https://www.sigmaaldrich.com/IN/en/search/mbs",
            notes="Polymer modifier chemical",
        ),
    ]

    analysis = CostAnalysis(
        analysis_status="applicable_evaluated",
        project_scope="physical_only",
        currency="INR",
        deck_declared_budget=25000.0,
        itemized_declared_cost=None,
        total_declared_cost=25000.0,
        components=components,
    )

    reconciled = _reconcile_and_compute_totals(analysis)

    # Line totals: declared (31000) for the declared item, quantity *
    # estimated_market_cost (5 * 800 = 4000) for the omitted one.
    assert reconciled.components[0].line_total == 31000.0
    assert reconciled.components[1].line_total == 4000.0
    # CAPEX = 31000, OPEX = 4000, Total = 35000
    assert reconciled.physical_hardware_capex == 31000.0
    assert reconciled.chemical_consumables_opex == 4000.0
    assert reconciled.total_estimated_cost == 35000.0
    # Declared itemized = 31000, Deck declared budget = 25000
    assert reconciled.itemized_declared_cost == 31000.0
    assert reconciled.deck_declared_budget == 25000.0
    assert reconciled.missing_components_count == 1
    # Variance vs deck declared: 35000 - 25000 = 10000
    assert reconciled.cost_difference == 10000.0


def test_declared_cost_takes_precedence_over_benchmark_estimate():
    """Regression test: line_total used to always be quantity *
    estimated_market_cost, silently discarding a cost the team explicitly
    stated in their own deck. A declared component's line total (and
    therefore the headline CAPEX/OPEX/total) must reflect what the team
    actually said, not the model's benchmark guess."""
    components = [
        ProjectComponent(
            name="Raspberry Pi 4",
            category="equipment_hardware",
            cost_type="capex",
            quantity=1.0,
            unit="unit",
            estimated_market_cost=5000.0,  # benchmark guess, deliberately wrong
            is_declared_by_team=True,
            declared_cost=3500.0,  # what the team actually said they paid
            price_provenance="indicative_estimate",
            currency="INR",
            source_name="Amazon India",
            source_url="https://www.amazon.in/s?k=raspberry+pi+4",
            notes="",
        ),
    ]
    analysis = CostAnalysis(
        analysis_status="applicable_evaluated",
        project_scope="physical_only",
        currency="INR",
        components=components,
    )

    reconciled = _reconcile_and_compute_totals(analysis)

    assert reconciled.components[0].line_total == 3500.0
    assert reconciled.physical_hardware_capex == 3500.0
    assert reconciled.total_estimated_cost == 3500.0


def test_fallback_cost_analysis_does_not_fabricate_prices():
    deck_text = (
        "Slide 1: Chemical Polymer Compounding\n"
        "Slide 2: Extruder setup and chemical reagents.\n"
        "Slide 3: Budget ₹20,000 declared."
    )
    result = _fallback_cost_analysis(deck_text, "INR")

    assert isinstance(result, CostAnalysis)
    assert result.analysis_status == "incomplete_review_required"
    assert result.affordability_verdict == "unassessed"
    assert result.total_estimated_cost is None
    # Must not contain fabricated extruder or chemicals with arbitrary prices
    assert result.components == []
    assert "no speculative benchmark prices" in result.affordability_analysis.lower()


def test_software_cost_analysis_does_not_fabricate_zero_cost():
    context = SubmissionContext(
        problem_domain="Cloud AI",
        target_beneficiary="Hospitals",
        required_deliverables=["Web platform"],
        track_constraints=[],
        is_generic=False,
    )
    result = _software_cost_analysis(context=context, deck_text="Purely software web platform")
    assert result.analysis_status == "not_applicable"
    assert result.affordability_verdict == "not_applicable"
    # Crucial: Must NOT be 0.0, which would claim implementation is free!
    assert result.total_estimated_cost is None
    assert result.components == []
    assert "not applicable" in result.affordability_analysis.lower()


def test_resolve_source_info_provenance():
    # Catalog search with platform identification
    name, url, provenance = _resolve_source_info(
        "Raspberry Pi 4", "equipment_hardware", "Amazon India", "INR"
    )
    assert "Amazon India" in name
    assert "amazon.in" in url
    assert provenance == "indicative_estimate"

    # Sigma Aldrich
    name, url, provenance = _resolve_source_info(
        "ABS Resin", "chemicals_reagents", "Sigma-Aldrich", "INR"
    )
    assert "Sigma-Aldrich" in name
    assert "sigmaaldrich.com" in url
    assert provenance == "indicative_estimate"

    # Missing vendor
    name, url, provenance = _resolve_source_info(
        "Unknown Custom Sensor", "sensors_instrumentation", "", "INR"
    )
    assert "Robu" in name
    assert provenance == "indicative_estimate"


def test_resolve_source_info_always_synthesizes_a_search_url():
    """Regression test: the LLM has no live web access, so any specific
    product-page URL it returns (e.g. an ASIN-looking Amazon link) is a
    guess that can easily 404 -- _resolve_source_info no longer even takes
    such a candidate URL as input; every resolved link is always a platform
    *search* URL, which is guaranteed to resolve to a real page."""
    _name, url, provenance = _resolve_source_info(
        "DFRobot Gravity Analog Turbidity Sensor", "sensors_instrumentation", "Amazon India", "INR"
    )
    assert url == "https://www.amazon.in/s?k=DFRobot+Gravity+Analog+Turbidity+Sensor"
    assert "/dp/" not in url
    assert provenance == "indicative_estimate"


def test_sanitizer_removes_cloud_and_preserves_hardware():
    analysis = CostAnalysis(
        analysis_status="applicable_evaluated",
        project_scope="hybrid",
        currency="INR",
        deck_declared_budget=20000.0,
        components=[
            ProjectComponent(
                name="Arduino Uno Microcontroller",
                category="equipment_hardware",
                cost_type="capex",
                quantity=1.0,
                unit="unit",
                estimated_market_cost=1500.0,
                line_total=1500.0,
                is_declared_by_team=True,
                declared_cost=1500.0,
                currency="INR",
                source_name="Robu.in",
                source_url="https://robu.in",
                notes="Controller",
            ),
            ProjectComponent(
                name="AWS EC2 Monthly Cloud Subscription",
                category="other",
                cost_type="software_service",
                quantity=1.0,
                unit="month",
                estimated_market_cost=3000.0,
                line_total=3000.0,
                is_declared_by_team=True,
                declared_cost=3000.0,
                currency="INR",
                source_name="Amazon Web Services",
                source_url="",
                notes="Cloud server plan",
            ),
        ],
    )

    sanitized = _sanitize_cost_analysis(analysis)
    assert len(sanitized.components) == 1
    assert sanitized.components[0].name == "Arduino Uno Microcontroller"
    # Physical total only
    assert sanitized.total_estimated_cost == 1500.0
    assert sanitized.physical_hardware_capex == 1500.0
    assert sanitized.analysis_status == "applicable_evaluated"


def test_sanitizer_marks_empty_bom_incomplete_for_physical_project():
    analysis = CostAnalysis(
        analysis_status="applicable_evaluated",
        project_scope="physical_only",
        currency="INR",
        deck_declared_budget=0.0,
        components=[
            ProjectComponent(
                name="Kaggle GPU Subscription",
                category="other",
                cost_type="software_service",
                quantity=1.0,
                unit="month",
                estimated_market_cost=2500.0,
                line_total=2500.0,
                is_declared_by_team=False,
                currency="INR",
                source_name="Google",
                source_url="",
                notes="GPU plan",
            )
        ],
    )

    sanitized = _sanitize_cost_analysis(analysis)
    assert sanitized.components == []
    # An empty BOM on a physical project MUST NOT be not_applicable!
    assert sanitized.analysis_status == "incomplete_review_required"
    assert sanitized.affordability_verdict == "unassessed"
    assert sanitized.total_estimated_cost is None


@pytest.mark.asyncio
async def test_generate_cost_analysis_software_route():
    context = SubmissionContext(
        problem_domain="Quantum Machine Learning for Crop Stress Detection",
        target_beneficiary="Agricultural Researchers",
        required_deliverables=["Software algorithms"],
        track_constraints=[],
        is_generic=False,
    )
    deck = (
        "Purely software Quantum Machine Learning simulation in Qiskit. "
        "No hardware, physical machinery, or chemical reagents are used."
    )
    result = await generate_cost_analysis(
        context=context,
        problem_statement_text="QML software pipeline",
        deck_text=deck,
    )
    assert result.analysis_status == "not_applicable"
    assert result.affordability_verdict == "not_applicable"
    assert result.total_estimated_cost is None
    assert result.components == []
