from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.health import get_health


def _settings(supabase_url="https://x.supabase.co", supabase_anon_key="anon", groq_api_key="groq"):
    settings = AsyncMock()
    settings.supabase_url = supabase_url
    settings.supabase_anon_key = supabase_anon_key
    settings.groq_api_key = groq_api_key
    return settings


@pytest.mark.asyncio
async def test_get_health_ok_when_both_reachable():
    with (
        patch("app.health.get_settings", return_value=_settings()),
        patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get,
    ):
        mock_get.return_value = httpx.Response(200, request=httpx.Request("GET", "https://x"))
        result = await get_health()

    assert result.status == "ok"
    assert result.supabase == "reachable"
    assert result.groq == "reachable"


@pytest.mark.asyncio
async def test_get_health_degraded_when_supabase_unreachable():
    with (
        patch("app.health.get_settings", return_value=_settings()),
        patch("httpx.AsyncClient.get", side_effect=httpx.ConnectTimeout("timed out")),
    ):
        result = await get_health()

    assert result.status == "degraded"
    assert result.supabase == "unreachable"
    assert result.groq == "unreachable"


@pytest.mark.asyncio
async def test_get_health_treats_server_error_as_unreachable():
    with (
        patch("app.health.get_settings", return_value=_settings()),
        patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get,
    ):
        mock_get.return_value = httpx.Response(503, request=httpx.Request("GET", "https://x"))
        result = await get_health()

    assert result.status == "degraded"
    assert result.supabase == "unreachable"
    assert result.groq == "unreachable"


@pytest.mark.asyncio
async def test_get_health_unreachable_when_settings_missing():
    with patch("app.health.get_settings", return_value=_settings(supabase_url="", groq_api_key="")):
        result = await get_health()

    assert result.status == "degraded"
    assert result.supabase == "unreachable"
    assert result.groq == "unreachable"
