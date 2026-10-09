// `pnpm dev` entry point -- NOT `pnpm --parallel -r run dev` for the API.
//
// pnpm --parallel pipes every child's stdout/stderr through its own
// multiplexer so it can prefix each line with "apps/api dev: " -- and on
// this Windows setup, that pipe redirection breaks asyncio's
// ProactorEventLoop subprocess support (what apps/api needs to invoke
// LibreOffice for slide rendering): asyncio.create_subprocess_exec raises a
// bare NotImplementedError under it, even with the event loop policy
// correctly set (see apps/api/run_dev.py). Running the API with
// stdio: "inherit" instead -- a direct console handle, not a pipe -- avoids
// the problem entirely. web and @hackeval/types don't invoke subprocesses,
// so they stay on pnpm's normal piped/prefixed output.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(command, args, cwd, useShell) {
  const child = spawn(command, args, { cwd, stdio: "inherit", shell: useShell });
  child.on("exit", (code) => {
    console.log(`[dev] ${command} ${args.join(" ")} exited with code ${code}`);
  });
  return child;
}

const children = [
  // No shell: a direct .exe path needs no resolution, and Node's
  // documented deprecation warns against shell:true with an args array
  // (unescaped concatenation) -- pnpm below is a .cmd on Windows and does
  // need the shell to resolve it.
  run(".venv\\Scripts\\python.exe", ["run_dev.py"], path.join(root, "apps", "api"), false),
  run("pnpm", ["--filter", "web", "run", "dev"], root, true),
  run("pnpm", ["--filter", "@hackeval/types", "run", "dev"], root, true),
];

function shutdown() {
  for (const child of children) child.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
