import pytest

from app.models.schemas import SubmissionContext
from app.research.cost_analyzer import (
    CostAnalysis,
    ProjectComponent,
    _detect_currency,
    _fallback_cost_analysis,
    _sanitize_cost_analysis,
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


def test_excludes_subscriptions_and_cloud_services():
    from app.research.cost_analyzer import (
        ProjectComponent,
        _is_subscription_or_cloud,
        _sanitize_cost_analysis,
    )

    # Keywords detection
    assert _is_subscription_or_cloud("AWS EC2 Cloud Hosting", "other", "monthly server cost")
    assert _is_subscription_or_cloud("Kaggle GPU Pro Subscription", "other", "for ML model training")
    assert _is_subscription_or_cloud("Ksggle Cloud", "other", "gpu plan")
    assert _is_subscription_or_cloud("Claude 3.5 Sonnet API Credits", "other", "AI API token usage")
    assert _is_subscription_or_cloud("OpenAI ChatGPT Plus Subscription", "other", "prompt generation")
    assert _is_subscription_or_cloud("Azure Blob Storage", "other", "data storage")
    assert _is_subscription_or_cloud("Monthly SaaS Subscription Plan", "other", "software license")
    assert not _is_subscription_or_cloud("Lab Twin-Screw Extruder 20mm", "equipment_hardware", "pilot compounding unit")
    assert not _is_subscription_or_cloud("Core-Shell Rubber MBS Impact Modifier", "chemicals_reagents", "chemical additive")

    # Sanitizer filtering
    dummy_analysis = CostAnalysis(
        currency="INR",
        total_declared_cost=10000.0,
        total_estimated_cost=20000.0,
        cost_difference=10000.0,
        missing_components_count=2,
        affordability_verdict="moderate_realistic",
        affordability_score_recommendation=1.5,
        affordability_analysis="Test analysis",
        components=[
            ProjectComponent(
                name="Twin-Screw Extruder 20mm Barrel",
                category="equipment_hardware",
                is_declared_by_team=True,
                declared_cost=15000.0,
                estimated_market_cost=18000.0,
                currency="INR",
                source_name="IndiaMART",
                source_url="https://dir.indiamart.com/search.mp?ss=extruder",
                notes="Pilot processing machinery",
            ),
            ProjectComponent(
                name="AWS Cloud Compute Subscription",
                category="other",
                is_declared_by_team=True,
                declared_cost=2000.0,
                estimated_market_cost=2500.0,
                currency="INR",
                source_name="Amazon",
                source_url="",
                notes="Cloud server monthly subscription",
            ),
            ProjectComponent(
                name="Claude Sonnet API Subscription",
                category="other",
                is_declared_by_team=False,
                declared_cost=None,
                estimated_market_cost=3000.0,
                currency="INR",
                source_name="Anthropic",
                source_url="",
                notes="Claude LLM monthly credits",
            ),
        ],
    )

    sanitized = _sanitize_cost_analysis(dummy_analysis)
    component_names = [c.name for c in sanitized.components]
    assert "Twin-Screw Extruder 20mm Barrel" in component_names
    assert "AWS Cloud Compute Subscription" not in component_names
    assert "Claude Sonnet API Subscription" not in component_names
    assert sanitized.total_estimated_cost == 18000.0

@pytest.mark.asyncio
async def test_software_first_qml_project_marks_physical_bom_not_applicable():
    context = SubmissionContext(
        problem_domain="Quantum Machine Learning for Crop Stress Detection",
        target_beneficiary="Farmers",
        required_deliverables=["QML software pipeline"],
        track_constraints=[],
        is_generic=False,
        generic_reason=None,
    )
    deck_text = (
        "A purely software-based Quantum Machine Learning (QML) pipeline for crop stress detection. "
        "The implementation uses cloud-based quantum simulators and Qiskit Aer. "
        "No physical hardware, chemicals, or industrial processing is required."
    )

    from app.research.cost_analyzer import _is_software_first_project

    assert _is_software_first_project(context, deck_text)
    result = await generate_cost_analysis(
        context=context,
        problem_statement_text="Detect crop stress with a QML pipeline",
        deck_text=deck_text,
    )
    assert result.affordability_verdict == "not_applicable"
    assert result.components == []
    assert result.total_estimated_cost == 0.0
    assert result.cost_difference is None
    assert "not quantified" in result.affordability_analysis.lower()
    assert "not evidence" in result.affordability_analysis.lower()


def test_sanitizer_does_not_keep_high_cost_verdict_when_all_items_are_filtered():
    analysis = CostAnalysis(
        currency="INR",
        total_declared_cost=0.0,
        total_estimated_cost=250000.0,
        cost_difference=250000.0,
        missing_components_count=3,
        affordability_verdict="expensive_high_barrier",
        affordability_score_recommendation=0.2,
        affordability_analysis="Cloud GPU and API subscriptions are expensive.",
        components=[
            ProjectComponent(
                name="Cloud GPU Compute Subscription",
                category="other",
                is_declared_by_team=False,
                declared_cost=None,
                estimated_market_cost=150000.0,
                currency="INR",
                source_name="Online",
                source_url="",
                notes="Cloud compute subscription for QML simulation",
            ),
            ProjectComponent(
                name="Quantum Runtime API Credits",
                category="other",
                is_declared_by_team=False,
                declared_cost=None,
                estimated_market_cost=100000.0,
                currency="INR",
                source_name="Online",
                source_url="",
                notes="API subscription credits",
            ),
        ],
    )

    sanitized = _sanitize_cost_analysis(analysis)
    assert sanitized.components == []
    assert sanitized.total_estimated_cost == 0.0
    assert sanitized.total_declared_cost is None
    assert sanitized.cost_difference is None
    assert sanitized.missing_components_count == 0
    assert sanitized.affordability_verdict == "not_applicable"
    assert sanitized.affordability_score_recommendation == 0.0
    assert "does not prove" in sanitized.affordability_analysis

def test_sanitizer_marks_empty_model_bom_not_applicable():
    analysis = CostAnalysis(
        currency="INR",
        total_declared_cost=0.0,
        total_estimated_cost=0.0,
        cost_difference=0.0,
        missing_components_count=0,
        affordability_verdict="expensive_high_barrier",
        affordability_score_recommendation=0.2,
        affordability_analysis="The project is expensive.",
        components=[],
    )

    sanitized = _sanitize_cost_analysis(analysis)
    assert sanitized.affordability_verdict == "not_applicable"
    assert sanitized.affordability_score_recommendation == 0.0
    assert sanitized.total_declared_cost is None
    assert sanitized.cost_difference is None
    assert "did not return any itemized physical" in sanitized.affordability_analysis
    assert "does not prove" in sanitized.affordability_analysis

