"""Verifies the caller is the signed-in admin before any upload or control
action. The admin account's app_metadata.role=admin claim is only settable
by the service role (see the admin-creation script), never by the user
themselves, so it can't be spoofed from the client.
"""

from fastapi import Header, HTTPException

from app.supabase_client import get_service_client


async def get_current_admin_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ")

    response = get_service_client().auth.get_user(token)
    if response is None or response.user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if (response.user.app_metadata or {}).get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return response.user.id
