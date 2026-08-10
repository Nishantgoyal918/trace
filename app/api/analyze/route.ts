type InventoryLine = {
  id: string;
  file: string;
  lineNumber: number;
  text?: string;
  side?: "old" | "new";
};

type ReviewMode = "baseline" | "change";

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
  properties: {
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

function buildJourneyOrderingPrompt(body: { orderingKind?: string; journeys?: unknown[]; journey?: unknown; nodes?: unknown[]; edges?: unknown[] }) {
  if (body.orderingKind === "stages") {
    return `You organize one already-discovered software journey for human reading. Separate runtime sequence, alternate control-flow lanes, and system boundaries instead of mixing them into one stage label.

Return ONLY valid JSON matching this shape:
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

Return ONLY valid JSON matching this shape:
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

function buildPrompt(mode: ReviewMode, task: string, content: string, inventory: InventoryLine[], baselineContext: unknown[] = []) {
  const baselineRules = `Build a semantic map of the existing code for an engineer seeing this repository for the first time. For every node, explain what starts the behavior, what the code does in order, which decisions it makes, and what it returns, changes, stores, calls, or does on failure. Put that complete explanation into ordered bullet points. Set before and after to empty strings.`;
  const changeRules = `Explain the diff against an already-understood baseline for an engineer seeing this change for the first time. Describe the exact behavior or structure before and after as ordered bullet points, including the trigger, ordered actions, decisions, result, side effects, errors, and fallbacks. Make every fallback, error route, state access, output, contract, configuration, and test change explicit.`;

  return `You are ChangeGraph, a language-agnostic code comprehension engine. Do not use or assume an AST, compiler, parser, LSP, or repository access. Analyze only the supplied text and deterministic line inventory.

Analysis mode: ${mode}
${mode === "baseline" ? baselineRules : changeRules}

Rules:
1. Assign every bracketed source line ID to exactly one semantic node.
2. Use only supplied bracketed line IDs. Never invent or duplicate them.
3. Each supplied code line is formatted as [inventory-id] exact text; the bracketed prefix is metadata, not source code.
4. Use short, concrete, outcome-oriented titles. Avoid vague labels such as "updated logic".
5. Put unclear lines in an unknown node with low confidence instead of hiding them.
6. Add directed edges only for concrete containment, flow, dependency, routing, configuration, fallback, or test relationships.
7. Write each summary as 4-7 ordered bullet points in plain, simple English, normally 60-140 words total. Encode the bullets inside the JSON string as newline-separated lines, and start every line with "- ". Each bullet must be a complete, direct subject-verb-object sentence, not a fragment.
8. Preserve the whole behavioral explanation across the bullets. The points must answer what starts this behavior, what happens step by step, which decisions or branches alter the path, which collaborators or state participate, what result or side effect occurs, and what error or fallback applies. Omit only categories that truly do not exist. Define unavoidable project terms in place and avoid unexplained jargon or acronyms.
9. Do not say code merely "handles", "manages", "processes", or "orchestrates" something. Name the concrete actions, conditions, collaborators, and outcomes instead.
10. For change mode, write before and after as 2-5 complete, specific bullet points each, using newline-separated "- " lines and 30-100 words per field. Keep points in execution order and make the behavioral difference understandable without reading the source. For baseline mode, keep both empty.
11. Group related lines into 8-24 coherent behaviors rather than emitting one node per small syntax block. Do not combine unrelated functions only to reduce the node count.
12. Keep titles under 8 words. Detail belongs in the bullet points in summary, before, and after; never drop useful behavior merely to shorten a card.
13. Set codeIdentity to the exact function, method, class, component, route, heading, configuration section, or other named code boundary being explained. Include the filename when it improves clarity.
14. Describe behavior rather than translating syntax line by line. A reader should understand why the code exists and what observable result it creates.
15. Set provides to exact named interfaces this behavior exposes: functions, methods, classes, routes, events, commands, configuration keys, tables, queues, or stored data. Use names from the supplied code, not prose.
16. Set uses to exact named interfaces this behavior calls, imports, reads, writes, emits to, subscribes to, or otherwise depends on. Use names from the supplied code, not prose. Return empty arrays when none are visible.
17. Make cross-stack contracts comparable across languages. A frontend client uses "HTTP <METHOD> <normalized-path>" and its backend endpoint provides that identical string. Normalize dynamic segments as {name}.
18. For infrastructure, use matching contracts such as "DB READ <resource>", "DB WRITE <resource>", "QUEUE PUBLISH <name>", "QUEUE CONSUME <name>", "EVENT EMIT <name>", "EVENT RECEIVE <name>", "CACHE READ <name>", "CACHE WRITE <name>", "OBJECT STORE READ <name>", and "OBJECT STORE WRITE <name>". Repository, model, migration, table, queue, cache, and storage nodes should provide the operations they supply. Callers should list them in uses. Never invent a route or resource not supported by the supplied text.

Original task:
${task || "Not provided"}

Expected line ownership count: ${inventory.length}
${mode === "change" && baselineContext.length ? `\nRelevant existing-code concepts:\n${JSON.stringify(baselineContext)}` : ""}

${mode === "baseline" ? "Existing source snapshot" : "Unified diff"}:
${content}`;
}

function buildIntegrationPrompt(mode: ReviewMode, nodes: unknown[], integrationKind?: string, integrationFocus?: string) {
  const architectureRules = integrationKind === "architecture" ? `
This is the repository-wide architecture pass.
Architecture focus: ${integrationFocus || "end-to-end runtime relationships"}.
- Connect frontend requests, queries, mutations, and API clients to the backend endpoints that receive the same method/path, payload, operation, or response contract.
- Connect backend endpoints and services to repositories, database tables or collections, object storage, caches, queues, event consumers, and external services they actually read, write, publish to, or call.
- Connect queue and event publishers to consumers when names, payloads, or surrounding evidence agree.
- A useful runtime path may read: user action -> frontend request -> backend endpoint -> service decision -> database/storage/queue -> returned or emitted result.
- Do not require exact provides/uses text when the supplied evidence clearly shows the same route or resource. Treat path parameters such as :id, [id], and variable placeholders as equivalent.
- Direction follows runtime flow: caller to receiver, frontend to backend, and backend behavior to database/storage/queue. Prefer cross-file and cross-module edges; omit containment edges.
` : "";
  return `You connect independently analyzed ChangeGraph concepts into one coherent ${mode} map.

Return only JSON: {"edges":[{"source":"existing-node-id","target":"existing-node-id","label":"SHORT RELATION"}]}

Rules:
- Use only the exact supplied node IDs.
- Add only meaningful cross-concept containment, call flow, dependency, routing, configuration, fallback, or evidence relationships supported by the supplied files, named provides/uses interfaces, summaries, and evidence lines.
- Prioritize relationships where one concept's uses entry matches another concept's provides entry, then verify the direction using the evidence.
- Do not connect concepts based only on similar wording. If the dependency is not supported, omit it.
- Prefer 1-3 important edges per concept; do not create a dense mesh.
- Write labels as plain-English source-perspective phrases of 2-7 words that explain what the source gets from or does with the target, such as "gets the authenticated user", "reads retry settings", "sends the render request", or "is verified by tests".
- Never use generic labels such as "DEPENDS ON", "RELATES TO", "USES", or "CALLS" without naming the concrete value, capability, request, state, or evidence exchanged.
- Do not return nodes or prose.
${architectureRules}

Concepts:
${JSON.stringify(nodes)}`;
}

function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
    }
  }
  return "";
}

export async function POST(request: Request) {
  let body: {
    action?: "analyze" | "integrate" | "order";
    provider?: string;
    mode?: ReviewMode;
    source?: string;
    diff?: string;
    task?: string;
    inventory?: InventoryLine[];
    baselineContext?: unknown[];
    nodes?: unknown[];
    integrationKind?: "semantic" | "architecture";
    integrationFocus?: string;
    orderingKind?: "journeys" | "stages";
    journeys?: unknown[];
    journey?: unknown;
    edges?: unknown[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (body.provider !== "openai-api") {
    return Response.json({ error: "This route handles OpenAI API calls only. Codex local uses the loopback bridge." }, { status: 400 });
  }

  const mode: ReviewMode = body.mode === "baseline" ? "baseline" : "change";
  const action = body.action === "integrate" ? "integrate" : body.action === "order" ? "order" : "analyze";
  const content = mode === "baseline" ? body.source : body.diff;
  if (action === "analyze" && (!content || !Array.isArray(body.inventory) || body.inventory.length === 0)) {
    return Response.json({ error: mode === "baseline" ? "An existing source snapshot is required." : "A unified diff is required." }, { status: 400 });
  }
  if (action === "integrate" && (!Array.isArray(body.nodes) || body.nodes.length < 2)) {
    return Response.json({ error: "At least two semantic concepts are required for the connection pass." }, { status: 400 });
  }
  if (action === "order" && body.orderingKind === "journeys" && (!Array.isArray(body.journeys) || body.journeys.length < 2)) {
    return Response.json({ error: "At least two discovered journeys are required for journey ordering." }, { status: 400 });
  }
  if (action === "order" && body.orderingKind === "stages" && (!body.journey || !Array.isArray(body.nodes) || body.nodes.length === 0)) {
    return Response.json({ error: "A discovered journey and its nodes are required for stage ordering." }, { status: 400 });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured on the server. No fallback provider was used." }, { status: 503 });
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: action === "integrate"
        ? buildIntegrationPrompt(mode, body.nodes ?? [], body.integrationKind, body.integrationFocus)
        : action === "order"
          ? buildJourneyOrderingPrompt(body)
          : buildPrompt(mode, body.task || "", content ?? "", body.inventory ?? [], body.baselineContext ?? []),
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

  const responseBody = await upstream.json() as Record<string, unknown>;
  if (!upstream.ok) {
    const nestedError = responseBody.error && typeof responseBody.error === "object" ? (responseBody.error as { message?: string }).message : undefined;
    return Response.json({ error: nestedError || `OpenAI request failed (${upstream.status}).` }, { status: 502 });
  }

  try {
    const parsed = JSON.parse(extractOutputText(responseBody));
    return Response.json(action === "order" ? { provider: `OpenAI API · ${model}`, ordering: parsed } : { provider: `OpenAI API · ${model}`, analysis: parsed });
  } catch {
    return Response.json({ error: "OpenAI returned an unreadable semantic graph." }, { status: 502 });
  }
}
