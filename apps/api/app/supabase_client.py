from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache
def get_service_client() -> Client:
    """Service-role client: bypasses RLS. Used for all server-side writes/storage."""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
