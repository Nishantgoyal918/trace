import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFile = promisify(execFileCallback);
const SERVICE = process.env.CHANGEGRAPH_SERVICE_URL || "http://127.0.0.1:47831";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../../../..");
const serviceEntry = path.join(projectRoot, "local-bridge", "server.mjs");

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let event = {};
try { event = JSON.parse(raw || "{}"); } catch { event = {}; }
const repoPath = path.resolve(String(event.cwd || process.cwd()));

async function serviceReady() {
  try {
    return (await fetch(`${SERVICE}/health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

if (!(await serviceReady())) {
  const child = spawn(process.execPath, [serviceEntry], { cwd: projectRoot, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 900));
}

try {
  const { stdout: diff } = await execFile("git", ["-C", repoPath, "diff", "HEAD", "--"], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (!diff.trim()) process.exit(0);
  const response = await fetch(`${SERVICE}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "change",
      provider: "codex-local",
      diff,
      task: "Explain the change completed in the latest Claude Code turn.",
      repository: { name: path.basename(repoPath), path: repoPath }
    }),
  });
  if (!response.ok) process.exit(0);
  const job = await response.json();
  process.stdout.write(`ChangeGraph review launched: ${job.dashboardUrl}\n`);
} catch {
  // Hooks must never block Claude Code completion.
}

