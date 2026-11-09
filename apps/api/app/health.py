import asyncio

import httpx

from app.config import get_settings
from app.models.schemas import HealthStatus

_TIMEOUT = 3.0


async def _check_supabase() -> bool:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        return False
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{settings.supabase_url}/rest/v1/",
                headers={"apikey": settings.supabase_anon_key},
            )
        return resp.status_code < 500
    except httpx.HTTPError:
        return False


async def _check_groq() -> bool:
    settings = get_settings()
    if not settings.groq_api_key:
        return False
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            )
        return resp.status_code < 500
    except httpx.HTTPError:
        return False


async def _check_db(pool: object | None) -> bool:
    if pool is None:
        return True
    try:
        acquire_fn = getattr(pool, "acquire", None)
        if acquire_fn is None:
            return True
        async with acquire_fn() as conn:
            res = await conn.fetchval("SELECT 1")
            return res == 1
    except Exception:  # noqa: BLE001
        return False


async def get_health(pool: object | None = None) -> HealthStatus:
    supabase_ok, groq_ok, db_ok = await asyncio.gather(_check_supabase(), _check_groq(), _check_db(pool))
    return HealthStatus(
        status="ok" if supabase_ok and groq_ok and db_ok else "degraded",
        supabase="reachable" if supabase_ok else "unreachable",
        groq="reachable" if groq_ok else "unreachable",
        database="reachable" if db_ok else "unreachable",
    )
