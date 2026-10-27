from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.auth import get_current_admin_id


def _client_returning(user_id: str | None):
    client = MagicMock()
    if user_id is None:
        client.auth.get_user.return_value = None
    else:
        response = MagicMock()
        response.user.id = user_id
        client.auth.get_user.return_value = response
    return client


def _client_returning_role(user_id: str, role: str | None):
    client = MagicMock()
    response = MagicMock()
    response.user.id = user_id
    response.user.app_metadata = {"role": role} if role else {}
    client.auth.get_user.return_value = response
    return client


@pytest.mark.asyncio
async def test_get_current_admin_id_returns_user_id_for_admin_role():
    with patch(
        "app.auth.get_service_client",
        return_value=_client_returning_role("admin-123", "admin"),
    ):
        user_id = await get_current_admin_id(authorization="Bearer good-admin-token")

    assert user_id == "admin-123"


@pytest.mark.asyncio
async def test_get_current_admin_id_rejects_a_non_admin_user():
    with (
        patch(
            "app.auth.get_service_client",
            return_value=_client_returning_role("user-123", None),
        ),
        pytest.raises(HTTPException) as exc_info,
    ):
        await get_current_admin_id(authorization="Bearer regular-user-token")

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_get_current_admin_id_rejects_missing_bearer_prefix():
    with pytest.raises(HTTPException) as exc_info:
        await get_current_admin_id(authorization="not-a-bearer-token")

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_admin_id_rejects_when_supabase_returns_no_response():
    with (
        patch("app.auth.get_service_client", return_value=_client_returning(None)),
        pytest.raises(HTTPException) as exc_info,
    ):
        await get_current_admin_id(authorization="Bearer expired-token")

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_admin_id_rejects_when_response_has_no_user():
    client = MagicMock()
    response = MagicMock()
    response.user = None
    client.auth.get_user.return_value = response

    with (
        patch("app.auth.get_service_client", return_value=client),
        pytest.raises(HTTPException) as exc_info,
    ):
        await get_current_admin_id(authorization="Bearer revoked-token")

    assert exc_info.value.status_code == 401
