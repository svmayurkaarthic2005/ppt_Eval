"""Dev entry point -- NOT `uvicorn app.main:app`.

`python -m uvicorn app.main:app` calls asyncio.run() (which locks in the
event loop's class for that run) *before* it ever imports app.main -- the
import happens later, inside Server.serve(), which by then is already
executing inside a loop asyncio.run() already created with the default
policy. So asyncio.set_event_loop_policy() at app.main's module level is
always too late on Windows: the loop is already a SelectorEventLoop by the
time that line runs, and SelectorEventLoop has no subprocess support there
(asyncio.create_subprocess_exec raises a bare NotImplementedError, which is
exactly how LibreOffice invocation failed even after that "fix").

Calling uvicorn.run(...) programmatically, from a script whose own
top-level code sets the policy first, is the only ordering that actually
works -- uvicorn.run() creates the loop itself, after this module's import
has already run.

reload=False deliberately: --reload's WatchFiles supervisor spawns a child
process per file change, and on this Windows setup that has repeatedly left
behind an orphaned TCP listener still serving the *pre-change* code --
invisible to Get-Process/tasklist/WMI, un-killable, requiring a port change
to escape. A single long-lived process (restarted manually after a backend
edit) is far more reliable here than fighting that.
"""

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8002, reload=False)
