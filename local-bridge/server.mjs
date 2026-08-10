import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";

const PORT = Number(process.env.CHANGEGRAPH_CODEX_PORT || 47831);
const DASHBOARD_URL = process.env.CHANGEGRAPH_DASHBOARD_URL || "http://localhost:3001";
const PARALLEL_WORKERS = Math.max(1, Number(process.env.CHANGEGRAPH_WORKERS || 4));
const INTEGRATION_WORKERS = Math.max(1, Number(process.env.CHANGEGRAPH_INTEGRATION_WORKERS || 3));
const TARGET_BATCH_CHARACTERS = 64_000;
const TARGET_BATCH_LINES = 900;
const MAX_ANALYSIS_SPLIT_DEPTH = 2;
const JOB_HEARTBEAT_MS = 10_000;
const DEFAULT_CODEX_TIMEOUT_MS = 30 * 60 * 1_000;
const configuredCodexTimeout = Number(process.env.CHANGEGRAPH_CODEX_TIMEOUT_MS || DEFAULT_CODEX_TIMEOUT_MS);
const CODEX_REQUEST_TIMEOUT_MS = Number.isFinite(configuredCodexTimeout) && configuredCodexTimeout >= 60_000
  ? configuredCodexTimeout
  : DEFAULT_CODEX_TIMEOUT_MS;
const PROMPT_VERSION = "semantic-v9-multi-axis-journeys";
const CACHE_DIR = path.resolve(process.env.CHANGEGRAPH_CACHE_DIR || ".changegraph/cache");
const jobs = new Map();
const inFlight = new Map();
let latestJobId = null;

const CODE_EXTENSIONS = new Set([
  "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "json", "kt",
  "md", "php", "ps1", "py", "rb", "rs", "scala", "scss", "sh", "sql", "svelte", "swift", "toml",
  "ts", "tsx", "vue", "xml", "yaml", "yml",
]);
const SKIPPED_DIRECTORIES = new Set([".git", ".next", ".turbo", ".venv", "build", "coverage", "dist", "node_modules", "out", "target", "vendor"]);
const SEMANTIC_KINDS = ["structure", "contract", "flow", "routing", "error", "fallback", "state", "output", "config", "test", "unknown"];

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nodes", "edges"],
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "codeIdentity", "kind", "summary", "before", "after", "lineIds", "confidence", "provides", "uses"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          codeIdentity: { type: "string" },
          kind: { type: "string", enum: SEMANTIC_KINDS },
          summary: { type: "string", description: "Four to seven complete plain-English bullet points separated by newlines; every line starts with - " },
          before: { type: "string", description: "For change analysis, two to five complete prior-behavior bullet points separated by newlines; empty for baseline" },
          after: { type: "string", description: "For change analysis, two to five complete new-behavior bullet points separated by newlines; empty for baseline" },
          lineIds: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          provides: { type: "array", items: { type: "string" } },
          uses: { type: "array", items: { type: "string" } },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "target", "label"],
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          label: { type: "string" },
        },
      },
    },
  },
};

const INTEGRATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["edges"],
  properties: { edges: ANALYSIS_SCHEMA.properties.edges },
};

const JOURNEY_PHASES = ["foundation", "queries", "commands", "automation", "recovery", "operations"];
const JOURNEY_FLOW_ROLES = ["trigger", "guard", "orchestration", "computation", "side-effect", "result"];
const JOURNEY_LANES = ["main", "async", "rejection", "retry", "fallback", "error", "compensation"];
const JOURNEY_BOUNDARIES = ["frontend", "backend", "database", "cache", "queue", "object-storage", "filesystem", "internal-service", "external-api"];
const JOURNEY_ORDER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["journeys"],
  properties: {
    journeys: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["journeyId", "phase", "capability", "sequence", "rationale"],
        properties: {
          journeyId: { type: "string" },
          phase: { type: "string", enum: JOURNEY_PHASES },
          capability: { type: "string" },
          sequence: { type: "number" },
          rationale: { type: "string" },
        },
      },
    },
  },
};
const JOURNEY_STAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["journeyId", "summary", "steps", "resources", "excludedNodes"],
  properties: {
    journeyId: { type: "string" },
    summary: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nodeId", "flowRole", "lane", "sequence", "predecessorIds", "boundaryRefs", "confidence", "evidence"],
        properties: {
          nodeId: { type: "string" },
          flowRole: { type: "string", enum: JOURNEY_FLOW_ROLES },
          lane: { type: "string", enum: JOURNEY_LANES },
          sequence: { type: "number" },
          predecessorIds: { type: "array", items: { type: "string" } },
          boundaryRefs: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: { type: "string" },
        },
      },
    },
    resources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["resourceId", "name", "kind", "systemBoundary"],
        properties: {
          resourceId: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: JOURNEY_BOUNDARIES },
          systemBoundary: { type: "string", enum: ["internal", "external"] },
        },
      },
    },
    excludedNodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nodeId", "reason"],
        properties: { nodeId: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
};

function corsHeaders(request) {
  return {
    "access-control-allow-origin": request.headers.origin || "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    vary: "Origin",
  };
}

function send(response, status, body, headers) {
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function parseJsonResponse(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : text);
}

function extractOpenAIText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of Array.isArray(response.output) ? response.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === "string") return part.text;
    }
  }
  return "";
}

function buildPrompt(body) {
  const mode = body.mode === "baseline" ? "baseline" : "change";
  const content = mode === "baseline" ? body.source : body.diff;
  const baselineContext = mode === "change" && Array.isArray(body.baselineContext) && body.baselineContext.length
    ? `\nRelevant existing-code concepts:\n${JSON.stringify(body.baselineContext)}`
    : "";
  return `You are the semantic engine for ChangeGraph. Analyze only the supplied text. Do not edit files, run commands, inspect the repository, or use an AST, compiler, parser, or LSP.

Return ONLY valid JSON:
{"nodes":[{"id":"short-id","title":"short outcome-oriented behavior label","codeIdentity":"exact function, class, component, route, heading, or named section","kind":"structure|contract|flow|routing|error|fallback|state|output|config|test|unknown","summary":"- Complete trigger point.\\n- Complete ordered action.\\n- Complete decision or state effect.\\n- Complete result or fallback.","before":"- Complete prior behavior point, or empty for baseline.","after":"- Complete new behavior point, or empty for baseline.","lineIds":["inventory-id"],"confidence":"high|medium|low","provides":["exact exposed symbol or interface"],"uses":["exact consumed symbol or interface"]}],"edges":[{"source":"node-id","target":"node-id","label":"SHORT RELATION"}]}

Mode: ${mode}
${mode === "baseline" ? "Map how the existing code works for an engineer seeing this repository for the first time." : "Explain every exact before-to-after effect of the diff for an engineer seeing this change for the first time."}

Rules:
- Every bracketed source line ID belongs to exactly one node. Never invent or duplicate IDs.
- The [inventory-id] prefix is metadata, not source code.
- Expose every fallback, error route, state access, output, contract, configuration, and test.
- Put unclear lines in a visible unknown node with low confidence.
- Write each summary as 4-7 ordered bullet points in plain, simple English, normally 60-140 words total. Encode them as newline-separated lines inside the JSON string, starting every line with "- ". Every bullet must be a complete direct sentence, not a fragment.
- Preserve the whole behavioral explanation across the bullets. The points must answer what starts this behavior, what happens step by step, which decisions or branches alter the path, which collaborators or state participate, what result or side effect occurs, and what error or fallback applies. Omit only categories that truly do not exist.
- Explicitly name errors, fallbacks, state changes, external calls, stored data, and visible outputs when they exist.
- Never say code merely "handles", "manages", "processes", or "orchestrates" something. Name the actual actions, conditions, collaborators, and outcomes.
- In change mode, before and after must each contain 2-5 complete bullet points, encoded as newline-separated "- " lines and totaling 30-100 words per field. Keep them in execution order. In baseline mode, keep both empty.
- Group related lines into 8-24 coherent behaviors rather than one node per syntax block. Do not combine unrelated functions only to reduce node count.
- Keep titles under 8 words. Put complete detail in the bullet points in summary, before, and after; never drop useful behavior merely to shorten a card.
- Set codeIdentity to the exact function, method, class, component, route, heading, configuration section, or other named code boundary being explained. Include the filename when it improves clarity.
- Describe behavior rather than translating syntax line by line. The reader should understand why the code exists and what observable result it creates.
- Set provides to exact named functions, methods, classes, routes, events, commands, configuration keys, tables, queues, or stored data this behavior exposes. Use names from the code, not prose.
- Set uses to exact named interfaces this behavior calls, imports, reads, writes, emits to, subscribes to, or otherwise depends on. Use names from the code, not prose. Return empty arrays when none are visible.
- Make cross-stack contracts comparable even when their implementations use different languages or symbol names. Use these canonical forms when the evidence is visible:
  - A frontend or API client uses "HTTP <METHOD> <normalized-path>"; the matching backend endpoint provides the identical string. Replace dynamic path values with {name}, for example "HTTP GET /api/jobs/{jobId}".
  - A database caller uses "DB READ <resource>" or "DB WRITE <resource>"; a repository, model, migration, or table behavior that supplies that operation provides the identical string.
  - Use matching "QUEUE PUBLISH <name>" / "QUEUE CONSUME <name>", "EVENT EMIT <name>" / "EVENT RECEIVE <name>", "CACHE READ <name>" / "CACHE WRITE <name>", and "OBJECT STORE READ <name>" / "OBJECT STORE WRITE <name>" contracts where applicable.
  - Include concrete request hooks, API client methods, backend routes, repositories, tables or collections, object stores, caches, queues, event topics, and external service calls. Do not invent a route or resource that is not supported by supplied code.
- Edges represent concrete containment, flow, dependency, routing, configuration, fallback, or evidence.

Original task:
${body.task || "Not provided"}

Expected line ownership count: ${body.inventory.length}${baselineContext}

${mode === "baseline" ? "Existing source snapshot" : "Unified diff"}:
${content}`;
}

function buildIntegrationPrompt(body) {
  const architectureRules = body.integrationKind === "architecture" ? `
This is the repository-wide architecture pass. Recover supported runtime paths across file, language, and module boundaries:
Architecture focus: ${body.integrationFocus || "end-to-end runtime relationships"}.
- Connect a frontend request, query, mutation, or API client to the backend endpoint that receives the same method/path, payload, operation, or response contract.
- Connect backend endpoints and services to repositories, database tables or collections, object storage, caches, queues, event consumers, and external services they actually read, write, publish to, or call.
- Connect queue/event publishers to their consumers when names, payloads, or surrounding evidence agree.
- A useful path may read: user action -> frontend request -> backend endpoint -> service decision -> database/storage/queue -> returned or emitted result.
- Do not require provides/uses strings to be identical when code evidence clearly shows the same route or resource. Treat normalized path parameters such as :id, [id], and concrete variable placeholders as equivalent.
- Direction must follow runtime information or control flow. The caller/requester is the source and the receiver/provider is the target. A backend behavior that stores data is the source and the database/storage behavior is the target.
- Prefer cross-file and cross-module edges that reveal the end-to-end system. Do not add containment edges in this pass.
` : "";
  return `You connect independently analyzed ChangeGraph concepts into one coherent ${body.mode === "baseline" ? "existing-code" : "change"} map.

Return ONLY JSON: {"edges":[{"source":"existing-node-id","target":"existing-node-id","label":"SHORT RELATION"}]}

Rules:
- Use only exact supplied node IDs and return no nodes or prose.
- Add only meaningful cross-concept containment, call flow, dependency, routing, configuration, fallback, or evidence relationships supported by supplied files, provides/uses interfaces, summaries, and evidence lines.
- Prioritize relationships where one concept's uses entry matches another concept's provides entry, then verify direction using evidence.
- Do not connect concepts based only on similar wording. Omit unsupported dependencies.
- Prefer 1-3 important edges per concept; do not create a dense mesh.
- Write labels as plain-English source-perspective phrases of 2-7 words that explain what the source gets from or does with the target, such as "gets the authenticated user", "reads retry settings", "sends the render request", or "is verified by tests".
- Never use generic labels such as "DEPENDS ON", "RELATES TO", "USES", or "CALLS" without naming the concrete value, capability, request, state, or evidence exchanged.
${architectureRules}

Concepts:
${JSON.stringify(body.nodes)}`;
}

function buildJourneyOrderingPrompt(body) {
  if (body.orderingKind === "stages") {
    return `You organize one already-discovered software journey for human reading. Separate runtime sequence, alternate control-flow lanes, and system boundaries instead of mixing them into one stage label.

Return ONLY valid JSON:
{"journeyId":"existing-journey-id","summary":"one short plain-English description of the reading path","steps":[{"nodeId":"existing-node-id","flowRole":"trigger|guard|orchestration|computation|side-effect|result","lane":"main|async|rejection|retry|fallback|error|compensation","sequence":0,"predecessorIds":["existing-node-id"],"boundaryRefs":["resource-id"],"confidence":"high|medium|low","evidence":"short observable reason"}],"resources":[{"resourceId":"stable-short-id","name":"concrete system or store name","kind":"frontend|backend|database|cache|queue|object-storage|filesystem|internal-service|external-api","systemBoundary":"internal|external"}],"excludedNodes":[{"nodeId":"existing-node-id","reason":"why this candidate is not part of this runtime behavior"}]}

Rules:
- Put every supplied node ID in either steps or excludedNodes exactly once. Exclude a node only when the evidence shows it belongs to a different behavior and was pulled in by a shared dependency or discovery heuristic.
- flowRole answers what the behavior does on the main runtime path: trigger starts it; guard admits or rejects it; orchestration coordinates calls and decisions; computation transforms or derives values; side-effect changes state, sends data, or invokes a boundary; result exposes the outcome.
- lane is independent of flowRole. Use main for the normal path, async for detached work, rejection for expected guard refusal, retry for another attempt, fallback for an alternate path, error for unexpected failure, and compensation for rollback or cleanup.
- Do not label a database, cache, queue, storage service, frontend, backend, or API as a stage. Add it once to resources and reference it from the relevant steps with boundaryRefs.
- external means outside the analyzed repository or product boundary. A different file, module, frontend, or backend inside this repository is internal.
- predecessorIds must contain only supplied node IDs with a supported direct runtime relationship. Do not infer a predecessor merely because two nodes share a resource.
- Sequence is the recommended reading order across the whole journey. Respect supplied edge direction when it represents runtime control or information flow; order alternate lanes immediately after the main step that branches to them.
- Keep unrelated branches separate. Do not treat a shared dependency as proof that two behaviors are one path.
- confidence and evidence must communicate how directly the classification is supported without exposing hidden reasoning. The summary must describe observable software behavior.

Journey:
${JSON.stringify(body.journey)}

Nodes:
${JSON.stringify(body.nodes)}

Existing edges:
${JSON.stringify(body.edges)}`;
  }
  return `You organize already-discovered end-to-end software journeys into the order an engineer should read them to understand the system. You may only order and categorize supplied journey IDs; never merge, omit, duplicate, or invent journeys.

Return ONLY valid JSON:
{"journeys":[{"journeyId":"existing-journey-id","phase":"foundation|queries|commands|automation|recovery|operations","capability":"short product-specific capability name","sequence":0,"rationale":"one short plain-English reason this belongs here"}]}

Rules:
- Include every supplied journey ID exactly once.
- phase describes behavior shape, not product domain: foundation is startup/configuration; queries read without intending to change state; commands create or change state; automation is event, queue, worker, scheduled, or background work; recovery restores or compensates; operations covers administration, maintenance, and observability.
- capability is the product-specific domain, such as Identity, Catalog, Billing, or Rendering. Do not use capability to decide phase: login may be a command and reading the current user may be a query even though both belong to Identity.
- Order a coherent system narrative from prerequisites through user-facing queries and commands, follow-on automation, recovery paths, and operations.
- Sequence journeys meaningfully within their phase using prerequisites, triggers, produced state, and observable outcomes.
- Shared endpoints, databases, workers, or services do not make two journeys the same. Preserve every distinct behavior journey.
- Do not claim relationships not present in the supplied contracts or behavior summaries.
- Rationale describes the observable prerequisite or outcome, never hidden reasoning.

Journeys:
${JSON.stringify(body.journeys)}`;
}

function validateRequest(body) {
  const action = body.action === "integrate" ? "integrate" : body.action === "order" ? "order" : "analyze";
  if (action === "integrate") {
    if (!Array.isArray(body.nodes) || body.nodes.length < 2) throw new Error("At least two semantic concepts are required for the connection pass.");
    return action;
  }
  if (action === "order") {
    if (body.orderingKind === "journeys" && (!Array.isArray(body.journeys) || body.journeys.length < 2)) throw new Error("At least two discovered journeys are required for journey ordering.");
    if (body.orderingKind === "stages" && (!body.journey || !Array.isArray(body.nodes) || body.nodes.length === 0)) throw new Error("A discovered journey and its nodes are required for stage ordering.");
    return action;
  }
  const mode = body.mode === "baseline" ? "baseline" : "change";
  const content = mode === "baseline" ? body.source : body.diff;
  if (!content || !Array.isArray(body.inventory) || body.inventory.length === 0) {
    throw new Error(mode === "baseline" ? "An existing source snapshot is required." : "A diff is required.");
  }
  return action;
}

async function callCodex(body) {
  const action = validateRequest(body);
  const codex = new Codex();
  const thread = codex.startThread();
  const prompt = action === "integrate" ? buildIntegrationPrompt(body) : action === "order" ? buildJourneyOrderingPrompt(body) : buildPrompt(body);
  const timeoutMinutes = Math.round(CODEX_REQUEST_TIMEOUT_MS / 60_000);
  const result = await withTimeout(thread.run(prompt), CODEX_REQUEST_TIMEOUT_MS, `Codex local request timed out after ${timeoutMinutes} minutes`);
  const parsed = parseJsonResponse(result.finalResponse);
  return action === "order"
    ? { provider: "Codex SDK · local authentication", ordering: parsed }
    : { provider: "Codex SDK · local authentication", analysis: parsed };
}

async function callOpenAI(body) {
  const action = validateRequest(body);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for the local ChangeGraph service. No fallback provider was used.");
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: action === "integrate" ? buildIntegrationPrompt(body) : action === "order" ? buildJourneyOrderingPrompt(body) : buildPrompt(body),
      text: {
        format: {
          type: "json_schema",
          name: action === "integrate" ? "semantic_graph_connections" : action === "order" ? body.orderingKind === "stages" ? "journey_stage_order" : "journey_reading_order" : "semantic_code_graph",
          strict: true,
          schema: action === "integrate" ? INTEGRATION_SCHEMA : action === "order" ? body.orderingKind === "stages" ? JOURNEY_STAGE_SCHEMA : JOURNEY_ORDER_SCHEMA : ANALYSIS_SCHEMA,
        },
      },
    }),
  });
  const responseBody = await upstream.json();
  if (!upstream.ok) throw new Error(responseBody?.error?.message || `OpenAI request failed (${upstream.status}). No fallback provider was used.`);
  const parsed = parseJsonResponse(extractOpenAIText(responseBody));
  return action === "order"
    ? { provider: `OpenAI API · ${model}`, ordering: parsed }
    : { provider: `OpenAI API · ${model}`, analysis: parsed };
}

function cacheKeyFor(body, legacy = false) {
  const cacheBody = !legacy && body.action !== "integrate" && body.mode === "baseline"
    ? { ...body, task: "" }
    : body;
  return createHash("sha256").update(JSON.stringify({ prompt: PROMPT_VERSION, body: cacheBody })).digest("hex");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

async function callProviderWithRetry(body) {
  let finalError;
  const attempts = body.action === "analyze" || !body.action ? 2 : 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await (body.provider === "openai-api" ? callOpenAI(body) : callCodex(body));
    } catch (error) {
      finalError = error;
      if (attempt < attempts - 1) await delay(700 * (attempt + 1));
    }
  }
  throw finalError;
}

function splitAnalysisPayload(body) {
  if (!Array.isArray(body.inventory) || body.inventory.length < 2) return [];
  const middle = Math.ceil(body.inventory.length / 2);
  const parts = [body.inventory.slice(0, middle), body.inventory.slice(middle)];
  const contentKey = body.mode === "baseline" ? "source" : "diff";
  const sourceLines = String(body[contentKey] || "").split("\n");
  return parts.map((inventory) => {
    const ids = new Set(inventory.map((line) => line.id));
    const content = sourceLines.filter((line) => {
      if (!line.startsWith("[")) return false;
      const end = line.indexOf("] ");
      return end > 1 && ids.has(line.slice(1, end));
    }).join("\n");
    return { ...body, inventory, [contentKey]: content };
  }).filter((part) => part.inventory.length && part[contentKey]);
}

async function analyze(body, splitDepth = 0) {
  const key = cacheKeyFor(body);
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  const legacyPath = path.join(CACHE_DIR, `${cacheKeyFor(body, true)}.json`);
  for (const candidate of [...new Set([cachePath, legacyPath])]) {
    try {
      const cached = JSON.parse(await readFile(candidate, "utf8"));
      if (candidate !== cachePath) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cachePath, JSON.stringify(cached), "utf8");
      }
      return { ...cached, cached: true };
    } catch {
      // Try the next cache shape, then recompute.
    }
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const analyzeParts = async (parts) => {
    const results = [];
    for (const part of parts) results.push(await analyze(part, splitDepth + 1));
    return {
      provider: results.map((result) => result.provider).find(Boolean) || "Codex SDK · local authentication",
      analysis: mergeAnalyses(results.map((result) => result.analysis)),
      splitRecovery: true,
    };
  };
  const analysisContent = body.mode === "baseline" ? body.source : body.diff;
  const canSplit = splitDepth < MAX_ANALYSIS_SPLIT_DEPTH;
  const proactiveParts = canSplit && (body.action === "analyze" || !body.action) && (body.inventory?.length > 180 || String(analysisContent || "").length > 18_000) ? splitAnalysisPayload(body) : [];
  const promise = (proactiveParts.length === 2 ? analyzeParts(proactiveParts) : callProviderWithRetry(body))
    .catch(async (error) => {
      const parts = canSplit && (body.action === "analyze" || !body.action) ? splitAnalysisPayload(body) : [];
      if (parts.length !== 2) throw error;
      return analyzeParts(parts);
    })
    .then(async (result) => {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cachePath, JSON.stringify(result), "utf8");
      return { ...result, cached: false };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function withJobHeartbeat(job, work) {
  job.activeUnits += 1;
  job.updatedAt = new Date().toISOString();
  const timer = setInterval(() => {
    job.updatedAt = new Date().toISOString();
  }, JOB_HEARTBEAT_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    job.activeUnits = Math.max(0, job.activeUnits - 1);
    job.updatedAt = new Date().toISOString();
  }
}

function isReadableRepositoryFile(filePath) {
  if (/(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock)(?:$|\.)/i.test(filePath.replaceAll("\\", "/"))) return false;
  const name = path.basename(filePath);
  if (["Dockerfile", "Makefile", "Procfile", "Gemfile"].includes(name)) return true;
  return CODE_EXTENSIONS.has(path.extname(name).slice(1).toLowerCase());
}

async function collectRepository(rootPath) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) await walk(absolute);
      } else if (entry.isFile() && isReadableRepositoryFile(absolute)) {
        const text = await readFile(absolute, "utf8");
        if (!text.includes("\0")) files.push({ path: path.relative(rootPath, absolute).replaceAll("\\", "/"), text });
      }
    }
  }
  await walk(rootPath);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function repositorySource(files) {
  return files.map((file) => `=== ${file.path} ===\n${file.text}`).join("\n\n");
}

function parseSource(source) {
  const inventory = [];
  let file = "source.txt";
  let lineNumber = 0;
  for (const raw of source.split(/\r?\n/)) {
    const header = raw.match(/^===\s+(.+?)\s+===$/);
    if (header) {
      file = header[1];
      lineNumber = 0;
      continue;
    }
    lineNumber += 1;
    if (raw.trim()) inventory.push({ id: `source:${file}:${lineNumber}`, file, lineNumber, text: raw });
  }
  return inventory;
}

function parseDiff(diff) {
  const inventory = [];
  let file = "unknown";
  let oldLine = 0;
  let newLine = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ ")) {
      const nextFile = raw.slice(4).trim();
      file = nextFile === "/dev/null" ? file : nextFile.replace(/^b\//, "");
      continue;
    }
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (raw.startsWith("diff --git") || raw.startsWith("index ") || raw.startsWith("--- ")) continue;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      inventory.push({ id: `new:${file}:${newLine}`, side: "new", file, lineNumber: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      inventory.push({ id: `old:${file}:${oldLine}`, side: "old", file, lineNumber: oldLine, text: raw.slice(1) });
      oldLine += 1;
    } else if (raw.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return inventory;
}

function buildBatches(inventory) {
  const byFile = new Map();
  for (const line of inventory) byFile.set(line.file, [...(byFile.get(line.file) || []), line]);
  const segments = [];
  for (const lines of byFile.values()) {
    let current = [];
    let characters = 0;
    for (const line of lines) {
      const size = line.id.length + line.text.length + 8;
      if (current.length && (current.length >= TARGET_BATCH_LINES || characters + size > TARGET_BATCH_CHARACTERS)) {
        segments.push(current);
        current = [];
        characters = 0;
      }
      current.push(line);
      characters += size;
    }
    if (current.length) segments.push(current);
  }

  const packed = [];
  let current = [];
  let characters = 0;
  for (const segment of segments) {
    const size = segment.reduce((sum, line) => sum + line.id.length + line.text.length + 8, 0);
    if (current.length && (current.length + segment.length > TARGET_BATCH_LINES || characters + size > TARGET_BATCH_CHARACTERS)) {
      packed.push(current);
      current = [];
      characters = 0;
    }
    current.push(...segment);
    characters += size;
  }
  if (current.length) packed.push(current);
  return packed.map((lines, index) => ({
    id: `work-${index + 1}`,
    files: [...new Set(lines.map((line) => line.file))],
    inventory: lines.map(({ id, file, lineNumber, side }) => ({ id, file, lineNumber, side })),
    content: lines.map((line) => `[${line.id}] ${line.text}`).join("\n"),
  }));
}

async function runParallel(items, workers, run) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await run(items[index], index);
    }
  }));
}

function mergeAnalyses(analyses) {
  const nodes = [];
  const edges = [];
  analyses.forEach((analysis, batchIndex) => {
    if (!analysis) return;
    const ids = new Map();
    for (const node of analysis.nodes || []) {
      const id = `batch-${batchIndex}-${node.id || nodes.length}`;
      ids.set(node.id, id);
      nodes.push({ ...node, id });
    }
    for (const edge of analysis.edges || []) {
      const source = ids.get(edge.source);
      const target = ids.get(edge.target);
      if (source && target) edges.push({ ...edge, source, target });
    }
  });
  return { nodes, edges };
}

function normalizeDependencyInterface(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[()`'"\s]+/g, "")
    .replace(/[^a-z0-9_./:@-]+/g, "");
}

function integrationWindows(nodes) {
  const windows = [];
  const signatures = new Set();
  const addWindow = (items) => {
    const unique = [...new Map(items.map((node) => [node.id, node])).values()];
    if (unique.length < 2) return;
    const signature = unique.map((node) => node.id).sort().join("|");
    if (signatures.has(signature)) return;
    signatures.add(signature);
    windows.push(unique);
  };

  const providers = new Map();
  nodes.forEach((node) => (Array.isArray(node.provides) ? node.provides : []).forEach((name) => {
    const key = normalizeDependencyInterface(name);
    if (key) providers.set(key, [...(providers.get(key) || []), node]);
  }));
  const adjacency = new Map();
  nodes.forEach((consumer) => (Array.isArray(consumer.uses) ? consumer.uses : []).forEach((name) => {
    const key = normalizeDependencyInterface(name);
    for (const provider of providers.get(key) || []) {
      if (provider.id === consumer.id) continue;
      adjacency.set(consumer.id, new Set([...(adjacency.get(consumer.id) || []), provider.id]));
      adjacency.set(provider.id, new Set([...(adjacency.get(provider.id) || []), consumer.id]));
    }
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const queue = [start];
    const component = [];
    visited.add(start);
    while (queue.length) {
      const id = queue.shift();
      const node = byId.get(id);
      if (node) component.push(node);
      for (const neighbor of adjacency.get(id) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    for (let startIndex = 0; startIndex < component.length; startIndex += 72) addWindow(component.slice(startIndex, startIndex + 80));
  }

  const size = 120;
  const overlap = 16;
  for (let start = 0; start < nodes.length; start += size - overlap) {
    const window = nodes.slice(start, start + size);
    addWindow(window);
    if (start + size >= nodes.length) break;
  }
  return windows;
}

function integrationNodeContext(nodes, inventory) {
  const byLineId = new Map(inventory.map((line) => [line.id, line]));
  return nodes.map((node) => {
    const lines = (node.lineIds || []).map((lineId) => byLineId.get(lineId)).filter(Boolean);
    return {
      id: node.id,
      title: node.title,
      codeIdentity: node.codeIdentity || "Unknown code boundary",
      kind: node.kind,
      summary: node.summary,
      files: [...new Set(lines.map((line) => line.file))],
      provides: Array.isArray(node.provides) ? node.provides : [],
      uses: Array.isArray(node.uses) ? node.uses : [],
      evidence: lines.slice(0, 6).map((line) => `[${line.id}] ${line.text}`).join("\n"),
    };
  });
}

const ARCHITECTURE_STOP_WORDS = new Set([
  "about", "after", "before", "behavior", "calls", "code", "data", "file", "from", "into", "node",
  "request", "response", "return", "returns", "service", "that", "their", "then", "this", "uses", "when", "with",
]);

function architectureText(node) {
  return [
    node.title,
    node.codeIdentity,
    node.kind,
    node.summary,
    ...(node.files || []),
    ...(node.provides || []),
    ...(node.uses || []),
    node.evidence,
  ].filter(Boolean).join("\n");
}

function architectureTokens(nodes) {
  const tokens = new Set();
  for (const node of nodes) {
    const expanded = architectureText(node).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    for (const token of expanded.match(/[a-z0-9][a-z0-9_./:{-]{2,}/g) || []) {
      const normalized = token.replace(/^[-./:]+|[-./:]+$/g, "");
      if (normalized.length >= 3 && !ARCHITECTURE_STOP_WORDS.has(normalized)) tokens.add(normalized);
    }
  }
  return tokens;
}

function architectureWindows(nodes) {
  const windows = [];
  const signatures = new Set();
  const addWindow = (focus, items) => {
    const unique = [...new Map(items.map((node) => [node.id, node])).values()];
    if (unique.length < 2) return;
    const signature = `${focus}|${unique.map((node) => node.id).sort().join("|")}`;
    if (signatures.has(signature)) return;
    signatures.add(signature);
    windows.push({ focus, nodes: unique });
  };
  const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
  const addPairedWindows = (focus, callers, providers) => {
    if (!callers.length || !providers.length) return;
    for (const callerChunk of chunks(callers, 28)) {
      const callerTokens = architectureTokens(callerChunk);
      const rankedProviders = providers
        .filter((provider) => !callerChunk.some((caller) => caller.id === provider.id))
        .map((provider) => {
          const providerTokens = architectureTokens([provider]);
          let score = 0;
          for (const token of providerTokens) if (callerTokens.has(token)) score += token.includes("/") ? 5 : 1;
          return { provider, score };
        })
        .sort((left, right) => right.score - left.score || left.provider.id.localeCompare(right.provider.id))
        .slice(0, 48)
        .map(({ provider }) => provider);
      addWindow(focus, [...callerChunk, ...rankedProviders]);
    }
  };

  const fileText = (node) => (node.files || []).join(" ").toLowerCase();
  const isFrontend = (node) => /(^|\/)(frontend|client|web|ui|mobile)(\/|$)/.test(fileText(node))
    || /\.(tsx?|jsx?|vue|svelte)$/.test(fileText(node));
  const isBackend = (node) => /(^|\/)(backend|server|api|routes?|controllers?)(\/|$)/.test(fileText(node))
    || /\.(py|go|java|kt|rb|php|cs|rs)$/.test(fileText(node));
  const isNetworkBoundary = (node) => /\b(fetch|axios|http|https|endpoint|router|route|request|response|websocket|eventsource|query|mutation|api client)\b|\/api\//i.test(architectureText(node));
  const isDataBoundary = (node) => /\b(database|db|sql|sqlalchemy|table|collection|repository|migration|persist|storage|object store|r2|s3|bucket|redis|cache|transaction|commit|flush)\b/i.test(architectureText(node))
    || /\/(models?|repositories|migrations|storage)\//.test(fileText(node));
  const isDataProvider = (node) => isDataBoundary(node) && (/\/(models?|repositories|migrations|storage)\//.test(fileText(node))
    || /\b(provides?|table|collection|repository|database|object store|bucket|cache)\b/i.test(architectureText(node)));
  const isEventBoundary = (node) => /\b(queue|publish|publisher|consume|consumer|subscribe|subscriber|event|topic|websocket|message broker|worker|job)\b/i.test(architectureText(node));

  const frontendRequests = nodes.filter((node) => isFrontend(node) && isNetworkBoundary(node));
  const backendEndpoints = nodes.filter((node) => isBackend(node) && (isNetworkBoundary(node) || ["routing", "contract"].includes(node.kind)));
  const backendDataCallers = nodes.filter((node) => isBackend(node) && isDataBoundary(node));
  const dataProviders = nodes.filter(isDataProvider);
  const eventNodes = nodes.filter(isEventBoundary);

  addPairedWindows("frontend requests to backend endpoints", frontendRequests, backendEndpoints);
  addPairedWindows("backend behavior to database and storage", backendDataCallers, dataProviders);
  for (const eventChunk of chunks(eventNodes, 72)) addWindow("queues, events, workers, and realtime delivery", eventChunk);
  return windows;
}

function publicJob(job) {
  const analysis = mergeAnalyses(job.analyses);
  const edgeKeys = new Set(analysis.edges.map((edge) => `${edge.source}|${edge.target}|${edge.label}`));
  for (const edge of job.crossEdges) {
    const key = `${edge.source}|${edge.target}|${edge.label}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      analysis.edges.push(edge);
    }
  }
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    provider: job.providerName || job.provider,
    repository: job.repository,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    total: job.total,
    completed: job.completed,
    connected: job.connected,
    connectionGroups: job.connectionGroups,
    architectureConnected: job.architectureConnected,
    architectureGroups: job.architectureGroups,
    cached: job.cached,
    activeUnits: job.activeUnits,
    fresh: job.fresh,
    error: job.error,
    source: job.source,
    analysis,
    dashboardUrl: `${DASHBOARD_URL}/?job=${job.id}`,
  };
}

async function runJob(job, batches) {
  job.status = "analyzing";
  job.updatedAt = new Date().toISOString();
  try {
    await runParallel(batches, PARALLEL_WORKERS, async (batch, index) => {
      if (index < PARALLEL_WORKERS) await delay(index * 300);
      const payload = {
        action: "analyze",
        provider: job.provider,
        mode: job.mode,
        task: job.task,
        inventory: batch.inventory,
        source: job.mode === "baseline" ? batch.content : undefined,
        diff: job.mode === "change" ? batch.content : undefined,
        baselineContext: job.baselineContext,
        cacheNonce: job.cacheNonce,
      };
      const result = await withJobHeartbeat(job, () => analyze(payload));
      job.analyses[index] = result.analysis;
      job.providerName = result.provider;
      job.completed += 1;
      if (result.cached) job.cached += 1;
      job.updatedAt = new Date().toISOString();
    });

    const merged = mergeAnalyses(job.analyses);
    const integrationInventory = job.mode === "baseline" ? parseSource(job.source) : parseDiff(job.source);
    const conceptContext = integrationNodeContext(merged.nodes, integrationInventory);
    const standardWindows = integrationWindows(merged.nodes).map((nodes) => ({
      kind: "semantic",
      focus: "cross-file semantic relationships",
      nodes: integrationNodeContext(nodes, integrationInventory),
    }));
    const endToEndWindows = architectureWindows(conceptContext).map((window) => ({ ...window, kind: "architecture" }));
    const windows = [...standardWindows, ...endToEndWindows];
    job.connectionGroups = windows.length;
    job.architectureGroups = endToEndWindows.length;
    if (windows.length) {
      job.status = "connecting";
      await runParallel(windows, INTEGRATION_WORKERS, async (window) => {
        const result = await withJobHeartbeat(job, () => analyze({
          action: "integrate",
          provider: job.provider,
          mode: job.mode,
          integrationKind: window.kind,
          integrationFocus: window.focus,
          nodes: window.nodes,
          cacheNonce: job.cacheNonce,
        }));
        job.crossEdges.push(...(result.analysis.edges || []));
        job.connected += 1;
        if (window.kind === "architecture") job.architectureConnected += 1;
        if (result.cached) job.cached += 1;
        job.updatedAt = new Date().toISOString();
      });
    }
    job.status = "complete";
    job.updatedAt = new Date().toISOString();
  } catch (error) {
    job.status = "error";
    job.error = error instanceof Error ? error.message : "Unknown analysis error";
    job.updatedAt = new Date().toISOString();
  }
}

async function createJob(body) {
  const mode = body.mode === "change" ? "change" : "baseline";
  let source = mode === "change" ? String(body.diff || "") : String(body.source || "");
  let repository = body.repository || null;
  if (mode === "baseline" && body.repoPath) {
    const rootPath = path.resolve(String(body.repoPath));
    const files = await collectRepository(rootPath);
    source = repositorySource(files);
    repository = { name: path.basename(rootPath), path: rootPath, files: files.length };
  }
  const inventory = mode === "baseline" ? parseSource(source) : parseDiff(source);
  if (!inventory.length) throw new Error(mode === "baseline" ? "No supported source lines were found." : "No changed lines were found in the diff.");
  const batches = buildBatches(inventory);
  const id = randomUUID();
  const now = new Date().toISOString();
  const fresh = body.fresh === true;
  const job = {
    id,
    status: "queued",
    mode,
    provider: body.provider === "openai-api" ? "openai-api" : "codex-local",
    providerName: "",
    repository,
    task: String(body.task || ""),
    baselineContext: Array.isArray(body.baselineContext) ? body.baselineContext : [],
    source,
    total: batches.length,
    completed: 0,
    connected: 0,
    connectionGroups: 0,
    architectureGroups: 0,
    architectureConnected: 0,
    cached: 0,
    activeUnits: 0,
    fresh,
    cacheNonce: fresh ? id : undefined,
    analyses: new Array(batches.length),
    crossEdges: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  latestJobId = id;
  void runJob(job, batches);
  return publicJob(job);
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw || "{}");
}

const server = createServer(async (request, response) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, {
      ok: true,
      service: "changegraph-local-service",
      provider: "Codex SDK - local authentication",
      parallelWorkers: PARALLEL_WORKERS,
      requestTimeoutMinutes: Math.round(CODEX_REQUEST_TIMEOUT_MS / 60_000),
      cache: CACHE_DIR,
      activeJobs: [...jobs.values()].filter((job) => ["queued", "analyzing", "connecting"].includes(job.status)).length,
    }, headers);
    return;
  }
  if (request.method === "GET" && request.url === "/jobs/latest") {
    const job = latestJobId ? jobs.get(latestJobId) : null;
    send(response, job ? 200 : 404, job ? publicJob(job) : { error: "No ChangeGraph job has been created." }, headers);
    return;
  }
  const requestUrl = new URL(request.url || "/", `http://127.0.0.1:${PORT}`);
  if (request.method === "GET" && requestUrl.pathname === "/file") {
    const job = jobs.get(requestUrl.searchParams.get("job") || "");
    const requestedPath = (requestUrl.searchParams.get("path") || "").replaceAll("\\", "/");
    if (!job?.repository?.path || !requestedPath) {
      send(response, 404, { error: "Repository file is unavailable for this job." }, headers);
      return;
    }
    try {
      const rootPath = path.resolve(job.repository.path);
      const absolutePath = path.resolve(rootPath, requestedPath);
      const relativePath = path.relative(rootPath, absolutePath);
      if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath) || !isReadableRepositoryFile(absolutePath)) {
        throw new Error("Requested file is outside the analyzed repository or is not readable source code.");
      }
      const content = await readFile(absolutePath, "utf8");
      if (content.includes("\0")) throw new Error("Binary files cannot be opened in the code reader.");
      send(response, 200, { path: relativePath.replaceAll("\\", "/"), content }, headers);
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : "Could not read repository file." }, headers);
    }
    return;
  }
  const jobMatch = request.url?.match(/^\/jobs\/([a-f0-9-]+)$/i);
  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    send(response, job ? 200 : 404, job ? publicJob(job) : { error: "ChangeGraph job not found." }, headers);
    return;
  }

  try {
    if (request.method === "POST" && request.url === "/analyze") {
      const body = await readJson(request);
      const result = await analyze(body);
      send(response, 200, result, headers);
      return;
    }
    if (request.method === "POST" && request.url === "/jobs") {
      const job = await createJob(await readJson(request));
      send(response, 202, job, headers);
      return;
    }
  } catch (error) {
    send(response, 500, {
      error: `ChangeGraph local service failed: ${error instanceof Error ? error.message : "unknown error"}. No fallback provider was used.`,
    }, headers);
    return;
  }

  send(response, 404, { error: "Not found." }, headers);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ChangeGraph local service listening on http://127.0.0.1:${PORT}`);
  console.log(`Parallel workers: ${PARALLEL_WORKERS}; cache: ${CACHE_DIR}`);
});
