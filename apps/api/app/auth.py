"""Resolves the calling team's Supabase user id from a bearer token.

The frontend signs in anonymously via supabase-js before its first upload
(see apps/web/src/lib/supabaseClient.ts) so every team has a stable
auth.users id to own its rows under the RLS policies from
supabase/migrations/20260101000200_storage_and_rls.sql.
"""

from fastapi import Header, HTTPException

from app.supabase_client import get_service_client


async def get_current_user_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ")

    response = get_service_client().auth.get_user(token)
    if response is None or response.user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return response.user.id


async def get_current_admin_id(authorization: str = Header(...)) -> str:
    """Same bearer-token check as get_current_user_id, but also requires
    app_metadata.role == "admin" -- app_metadata can only be set by the
    service role (the signup/admin-creation script), never by the user
    themselves, so this can't be spoofed from the client."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ")

    response = get_service_client().auth.get_user(token)
    if response is None or response.user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if (response.user.app_metadata or {}).get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return response.user.id
