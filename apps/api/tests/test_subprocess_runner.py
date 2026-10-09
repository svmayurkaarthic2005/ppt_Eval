import sys
from unittest.mock import patch

import pytest

from app.rendering.subprocess_runner import (
    SubprocessFailedError,
    SubprocessTimeoutError,
    SubprocessUnavailableError,
    run_with_timeout,
)


async def test_run_with_timeout_succeeds_on_zero_exit():
    await run_with_timeout([sys.executable, "-c", "pass"], timeout=5)


async def test_run_with_timeout_raises_on_nonzero_exit():
    with pytest.raises(SubprocessFailedError) as exc_info:
        await run_with_timeout(
            [sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.exit(1)"],
            timeout=5,
        )
    assert exc_info.value.returncode == 1
    assert b"boom" in exc_info.value.stderr


async def test_run_with_timeout_kills_and_raises_on_timeout():
    with pytest.raises(SubprocessTimeoutError):
        await run_with_timeout(
            [sys.executable, "-c", "import time; time.sleep(10)"],
            timeout=0.2,
        )


async def test_run_with_timeout_wraps_bare_notimplementederror_with_a_clear_message():
    """Regression test: on Windows, asyncio.create_subprocess_exec raises a
    bare NotImplementedError() (no message) when the running event loop
    isn't a ProactorEventLoop -- str(that) is '', which is exactly what
    showed up as an undiagnosable blank jobs.last_error in production. This
    must come back as something that actually explains what to fix."""
    with patch(
        "asyncio.create_subprocess_exec", side_effect=NotImplementedError()
    ), pytest.raises(SubprocessUnavailableError) as exc_info:
        await run_with_timeout([sys.executable, "-c", "pass"], timeout=5)
    assert str(exc_info.value) != ""
    assert "ProactorEventLoop" in str(exc_info.value)


async def test_run_with_timeout_wraps_filenotfounderror():
    with patch(
        "asyncio.create_subprocess_exec", side_effect=FileNotFoundError("soffice not found")
    ), pytest.raises(SubprocessUnavailableError) as exc_info:
        await run_with_timeout(["nonexistent_binary"], timeout=5)
    assert "executable not found" in str(exc_info.value)
