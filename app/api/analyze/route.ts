type InventoryLine = {
  id: string;
  side: "old" | "new";
  file: string;
  lineNumber: number;
  text: string;
};

const CHANGE_KINDS = ["contract", "routing", "error", "fallback", "state", "output", "config", "test", "unknown"];

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
        required: ["id", "title", "kind", "before", "after", "lineIds", "confidence"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          kind: { type: "string", enum: CHANGE_KINDS },
          before: { type: "string" },
          after: { type: "string" },
          lineIds: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
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

function buildPrompt(task: string, diff: string, inventory: InventoryLine[]) {
  return `You are ChangeGraph, a language-agnostic semantic diff analyst. Do not use or assume an AST, compiler, parser, LSP, or repository access. Analyze only the supplied unified diff and deterministic changed-line inventory.

Your job:
1. Group every inventory line ID into exactly one semantic change node.
2. Describe the exact behavior or structure before and after. Avoid vague summaries such as "updated error handling".
3. Make fallbacks, error routing, configuration, state reads/writes, outputs, contracts, and tests explicit.
4. Use only line IDs that appear in the inventory. Never invent IDs. Never assign an ID to two nodes.
5. If meaning is unclear, assign the line to an "unknown" node with low confidence rather than hiding it.
6. Add directed edges only when one change configures, enables, routes to, falls back to, or tests another change.
7. Keep node titles and before/after descriptions compact enough for a graph card.

Original task:
${task || "Not provided"}

Changed-line inventory:
${JSON.stringify(inventory)}

Unified diff:
${diff}`;
}

function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

export async function POST(request: Request) {
  let body: { provider?: string; diff?: string; task?: string; inventory?: InventoryLine[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (body.provider !== "openai-api") {
    return Response.json(
      { error: "This server route only handles OpenAI API calls. Codex local calls must go through the local bridge." },
      { status: 400 },
    );
  }
  if (!body.diff || !Array.isArray(body.inventory) || body.inventory.length === 0) {
    return Response.json({ error: "A unified diff with at least one changed line is required." }, { status: 400 });
  }
  if (body.diff.length > 180_000 || body.inventory.length > 4_000) {
    return Response.json({ error: "This POC accepts up to 180 KB or 4,000 changed lines per analysis." }, { status: 413 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured on the server. No fallback provider was used." },
      { status: 503 },
    );
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      input: buildPrompt(body.task || "", body.diff, body.inventory),
      text: {
        format: {
          type: "json_schema",
          name: "semantic_change_graph",
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
    }),
  });

  const responseBody = await upstream.json() as Record<string, unknown>;
  if (!upstream.ok) {
    const nestedError = responseBody.error && typeof responseBody.error === "object"
      ? (responseBody.error as { message?: string }).message
      : undefined;
    return Response.json({ error: nestedError || `OpenAI request failed (${upstream.status}).` }, { status: 502 });
  }

  try {
    const analysis = JSON.parse(extractOutputText(responseBody));
    return Response.json({ provider: `OpenAI API · ${model}`, analysis });
  } catch {
    return Response.json({ error: "OpenAI returned an unreadable semantic graph." }, { status: 502 });
  }
}
