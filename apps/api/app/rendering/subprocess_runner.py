"""Generic "run this command in its own process, with a hard timeout" helper.

Separated from slide_renderer.py so it's testable with any trivial
subprocess (no LibreOffice required) -- this is the part of a timeout-bound
external-process call that's actually easy to get wrong (orphaned processes,
swallowed non-zero exit codes), so it earns its own direct tests.
"""

from __future__ import annotations

import asyncio


class SubprocessTimeoutError(Exception):
    pass


class SubprocessFailedError(Exception):
    def __init__(self, returncode: int, stderr: bytes):
        self.returncode = returncode
        self.stderr = stderr
        super().__init__(f"exited {returncode}: {stderr.decode(errors='replace')[:500]}")


class SubprocessUnavailableError(Exception):
    """Raised when the process could never even be started -- distinct from
    SubprocessFailedError (started, then exited non-zero). The one real-world
    trigger seen so far: asyncio.create_subprocess_exec raises a bare
    NotImplementedError() on Windows when the running event loop isn't a
    ProactorEventLoop (the default SelectorEventLoop doesn't support
    subprocesses there) -- and a bare NotImplementedError stringifies to an
    empty string, which otherwise surfaces as a blank, undiagnosable
    jobs.last_error. Wrapping it here turns that into a message that
    actually explains what to fix."""


async def run_with_timeout(argv: list[str], timeout: float) -> None:
    """Runs argv as its own OS process; kills it if it outlives `timeout`.

    ponytail: kills only the direct child. LibreOffice's soffice.bin
    sub-process can outlive a killed soffice launcher wrapper; add process-
    group / job-object cleanup (POSIX: os.setsid + killpg; Windows: a Job
    Object) if orphaned soffice.bin processes become a problem in practice.
    """
    try:
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except NotImplementedError as exc:
        raise SubprocessUnavailableError(
            f"could not start {argv[0]!r}: this process's asyncio event loop doesn't "
            "support subprocesses (on Windows, main.py must set "
            "asyncio.WindowsProactorEventLoopPolicy() before any event loop starts)."
        ) from exc
    except FileNotFoundError as exc:
        raise SubprocessUnavailableError(
            f"could not start {argv[0]!r}: executable not found on PATH or at specified location."
        ) from exc
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except TimeoutError as exc:
        process.kill()
        await process.wait()
        raise SubprocessTimeoutError(f"{argv[0]} exceeded {timeout}s") from exc

    if process.returncode != 0:
        raise SubprocessFailedError(process.returncode or -1, stderr)
