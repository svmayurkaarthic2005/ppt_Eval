from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.models.schemas import SubmissionContext
from app.research.scholarly import (
    ScholarlyPaper,
    fetch_arxiv_papers,
    fetch_semantic_scholar_papers,
    generate_academic_benchmark,
)


@pytest.fixture
def sample_context():
    return SubmissionContext(
        problem_domain="Healthcare Diagnostics",
        target_beneficiary="Rural clinics",
        required_deliverables=["mobile app", "diagnostic model"],
        track_constraints=[],
        is_generic=False,
    )


@pytest.fixture
def sample_paper():
    return ScholarlyPaper(
        title="Automated Diagnostic Baselines in Rural Healthcare",
        source="Semantic Scholar",
        venue="IEEE Trans Biomed Eng (2023)",
        authors="A. Sharma, B. Patel",
        year="2023",
        url="https://doi.org/10.1109/TBME.2023.12345",
        summary="A peer-reviewed benchmark study evaluating point-of-care diagnostics.",
    )


@pytest.mark.asyncio
async def test_generate_academic_benchmark_empty_papers(sample_context):
    """When no papers are retrieved, status is no_literature_found and does NOT claim novelty."""
    benchmark = await generate_academic_benchmark(
        context=sample_context,
        problem_statement_text="Low-cost malaria detection in remote clinics.",
        deck_text="We propose a phone camera microscope for malaria.",
        papers=[],
    )
    assert benchmark.status == "no_literature_found"
    assert benchmark.papers == []
    # Must explicitly state that absence of papers is NOT proof of novelty
    assert "not proof of novelty" in benchmark.why_ranked_explanation.lower()
    assert "no published academic literature" in benchmark.existing_solutions_summary.lower()


@pytest.mark.asyncio
async def test_generate_academic_benchmark_success(sample_context, sample_paper):
    """Successful LLM response parses into a completed benchmark."""
    llm_payload = {
        "existing_solutions_summary": "Existing models require lab microscopes with trained technicians.",
        "gaps_in_existing_solutions": "High false positive rates in ambient lighting conditions.",
        "why_ranked_explanation": "Team addresses lighting variance using ambient normalization.",
        "better_than_existing_aspects": ["Lightweight on-device model", "Sub-second inference"],
        "limitations_and_tradeoffs": ["Requires minimum 5MP camera resolution", "Battery drain"],
    }
    from unittest.mock import MagicMock
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": json.dumps(llm_payload)}}]
    }

    with patch("app.research.scholarly.post_with_backoff", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        benchmark = await generate_academic_benchmark(
            context=sample_context,
            problem_statement_text="Low-cost malaria detection in remote clinics.",
            deck_text="We propose a phone camera microscope for malaria.",
            papers=[sample_paper],
        )

    assert benchmark.status == "completed"
    assert len(benchmark.papers) == 1
    assert benchmark.existing_solutions_summary == llm_payload["existing_solutions_summary"]
    assert benchmark.better_than_existing_aspects == llm_payload["better_than_existing_aspects"]


@pytest.mark.asyncio
async def test_generate_academic_benchmark_synthesis_failure(sample_context, sample_paper):
    """When LLM call fails or throws, gracefully returns synthesis_failed with retrieved papers preserved."""
    with patch("app.research.scholarly.post_with_backoff", side_effect=RuntimeError("LLM API Timeout")):
        benchmark = await generate_academic_benchmark(
            context=sample_context,
            problem_statement_text="Low-cost malaria detection in remote clinics.",
            deck_text="We propose a phone camera microscope for malaria.",
            papers=[sample_paper],
        )

    assert benchmark.status == "synthesis_failed"
    assert len(benchmark.papers) == 1  # Preserves papers for manual review
    assert "failed" in benchmark.existing_solutions_summary.lower()
    assert "no superiority claim" in benchmark.better_than_existing_aspects[0].lower()


@pytest.mark.asyncio
async def test_fetch_semantic_scholar_papers_success():
    """Mock Semantic Scholar API returning valid papers."""
    mock_json = {
        "data": [
            {
                "title": "Deep Learning for Rural Healthcare",
                "venue": "Lancet Digital Health",
                "year": 2023,
                "authors": [{"name": "Dr. Smith"}, {"name": "Dr. Jones"}],
                "abstract": "A study on deploying deep learning models in low-resource settings.",
                "url": "https://doi.org/10.1016/S2589-7500(23)00001-1",
                "citationCount": 42,
            }
        ]
    }
    with patch("app.research.scholarly.get_settings") as mock_settings:
        mock_settings.return_value.semantic_scholar_api_key = "fake_key"
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = httpx.Response(200, json=mock_json, request=httpx.Request("GET", "https://api.semanticscholar.org"))
            papers = await fetch_semantic_scholar_papers("rural healthcare")

    assert len(papers) == 1
    assert papers[0].title == "Deep Learning for Rural Healthcare"
    assert "42 citations" in papers[0].summary
    assert "Dr. Smith, Dr. Jones" == papers[0].authors


@pytest.mark.asyncio
async def test_fetch_arxiv_papers_success():
    """Mock arXiv Atom XML feed parsing."""
    atom_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
            <id>http://arxiv.org/abs/2301.00001v1</id>
            <published>2023-01-01T00:00:00Z</published>
            <title>Robust Edge AI for Remote Telemedicine</title>
            <summary>We present a lightweight neural network architecture for rural diagnostics.</summary>
            <author><name>Alice Wang</name></author>
            <author><name>Bob Lee</name></author>
        </entry>
    </feed>
    """
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = httpx.Response(200, text=atom_xml, request=httpx.Request("GET", "http://export.arxiv.org/api/query"))
        papers = await fetch_arxiv_papers("telemedicine")

    assert len(papers) == 1
    assert papers[0].title == "Robust Edge AI for Remote Telemedicine"
    assert papers[0].authors == "Alice Wang, Bob Lee"
    assert papers[0].year == "2023"
    assert papers[0].url == "http://arxiv.org/abs/2301.00001v1"


@pytest.mark.asyncio
async def test_fetch_papers_timeout_handled_gracefully():
    """Network timeouts should return empty list without crashing."""
    with patch("httpx.AsyncClient.get", side_effect=httpx.ConnectTimeout("Connection timed out")):
        papers = await fetch_arxiv_papers("query")
        assert papers == []
