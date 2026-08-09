import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFile = promisify(execFileCallback);
const SERVICE = process.env.CHANGEGRAPH_SERVICE_URL || "http://127.0.0.1:47831";
const DASHBOARD = process.env.CHANGEGRAPH_DASHBOARD_URL || "http://localhost:3001";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");
const serviceEntry = path.join(projectRoot, "local-bridge", "server.mjs");

async function serviceReady() {
  try {
    const response = await fetch(`${SERVICE}/health`, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureService() {
  if (await serviceReady()) return;
  const child = spawn(process.execPath, [serviceEntry], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await serviceReady()) return;
  }
  throw new Error("ChangeGraph local service did not start. Run `npm run changegraph:service` in the ChangeGraph project.");
}

async function requestJson(url, init) {
  await ensureService();
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `ChangeGraph request failed (${response.status}).`);
  return body;
}

function summarizeJob(job) {
  return {
    id: job.id,
    status: job.status,
    repository: job.repository,
    completed: job.completed,
    total: job.total,
    connected: job.connected,
    connectionGroups: job.connectionGroups,
    cached: job.cached,
    error: job.error,
    dashboardUrl: job.dashboardUrl || `${DASHBOARD}/?job=${job.id}`,
  };
}

async function createRepositoryJob(args) {
  const repoPath = path.resolve(String(args.repoPath || process.cwd()));
  const job = await requestJson(`${SERVICE}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "baseline",
      provider: args.provider || "codex-local",
      repoPath,
      task: args.task || "Understand the existing code before reviewing changes.",
    }),
  });
  return summarizeJob(job);
}

async function createDiffJob(args) {
  const repoPath = path.resolve(String(args.repoPath || process.cwd()));
  const diffArgs = ["-C", repoPath, "diff"];
  if (args.base) diffArgs.push(String(args.base));
  else diffArgs.push("HEAD");
  diffArgs.push("--");
  const { stdout } = await execFile("git", diffArgs, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (!stdout.trim()) throw new Error("No tracked Git changes were found for the requested repository.");
  const job = await requestJson(`${SERVICE}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "change",
      provider: args.provider || "codex-local",
      diff: stdout,
      task: args.task || "Explain the current working-tree change.",
      repository: { name: path.basename(repoPath), path: repoPath },
      baselineContext: Array.isArray(args.baselineContext) ? args.baselineContext : [],
    }),
  });
  return summarizeJob(job);
}

const tools = [
  {
    name: "changegraph_index_repository",
    description: "Start a cached, file-aware parallel semantic index of an existing local repository and return its live dashboard URL.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Absolute repository directory. Defaults to the current working directory." },
        task: { type: "string", description: "What the user is trying to understand." },
        provider: { type: "string", enum: ["codex-local", "openai-api"], default: "codex-local" },
      },
    },
  },
  {
    name: "changegraph_review_diff",
    description: "Analyze the current Git diff against the cached code understanding and return a live before-to-after graph URL.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Absolute Git repository directory. Defaults to the current working directory." },
        base: { type: "string", description: "Optional Git revision to compare against. Defaults to HEAD." },
        task: { type: "string", description: "Original coding task or review objective." },
        provider: { type: "string", enum: ["codex-local", "openai-api"], default: "codex-local" },
        baselineContext: { type: "array", items: { type: "object" }, description: "Optional relevant baseline concept summaries." },
      },
    },
  },
  {
    name: "changegraph_job_status",
    description: "Read progress for a ChangeGraph job without returning its large source or graph payload.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "changegraph_open_dashboard",
    description: "Return the dashboard URL for a ChangeGraph job, or the most recent job when no ID is supplied.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
    },
  },
];

async function callTool(name, args = {}) {
  if (name === "changegraph_index_repository") return createRepositoryJob(args);
  if (name === "changegraph_review_diff") return createDiffJob(args);
  if (name === "changegraph_job_status") {
    return summarizeJob(await requestJson(`${SERVICE}/jobs/${encodeURIComponent(args.jobId)}`));
  }
  if (name === "changegraph_open_dashboard") {
    const job = await requestJson(args.jobId ? `${SERVICE}/jobs/${encodeURIComponent(args.jobId)}` : `${SERVICE}/jobs/latest`);
    return { dashboardUrl: job.dashboardUrl || `${DASHBOARD}/?job=${job.id}`, job: summarizeJob(job) };
  }
  throw new Error(`Unknown ChangeGraph tool: ${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (!message || typeof message !== "object" || !message.method) return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "changegraph", version: "0.2.0" },
      },
    });
    return;
  }
  if (message.method === "ping") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : "ChangeGraph tool failed." }],
        },
      });
    }
  }
}

process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      try {
        void handle(JSON.parse(line));
      } catch (error) {
        process.stderr.write(`Invalid MCP message: ${error instanceof Error ? error.message : "unknown error"}\n`);
      }
    }
    newline = buffer.indexOf("\n");
  }
});

