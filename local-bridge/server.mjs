import { createServer } from "node:http";
import { Codex } from "@openai/codex-sdk";

const PORT = Number(process.env.CHANGEGRAPH_CODEX_PORT || 47831);

function corsHeaders(request) {
  return {
    "access-control-allow-origin": request.headers.origin || "*",
    "access-control-allow-methods": "POST, OPTIONS",
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

function buildPrompt({ task, diff, inventory }) {
  return `You are the semantic analysis engine for ChangeGraph. This is analysis only: do not edit files, run commands, or inspect the repository. Do not use or assume an AST, compiler, LSP, parser, or any information outside this message.

Return ONLY valid JSON with this shape:
{"nodes":[{"id":"short-id","title":"compact label","kind":"contract|routing|error|fallback|state|output|config|test|unknown","before":"exact prior behavior","after":"exact new behavior","lineIds":["inventory-id"],"confidence":"high|medium|low"}],"edges":[{"source":"node-id","target":"node-id","label":"SHORT RELATION"}]}

Rules:
- Every supplied inventory line ID belongs to exactly one node. Never invent or duplicate line IDs.
- Explain exact before-to-after behavior, not just which function changed.
- Explicitly expose every fallback, error branch, state read/write, configuration change, output change, contract change, and test.
- Put unclear lines in a visible unknown node with low confidence.
- Edges must describe a concrete dependency, routing, fallback, configuration, or test relationship.
- Keep titles and before/after values compact enough for graph cards.

Original task:
${task || "Not provided"}

Changed-line inventory:
${JSON.stringify(inventory)}

Unified diff:
${diff}`;
}

const server = createServer(async (request, response) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (request.method !== "POST" || request.url !== "/analyze") {
    send(response, 404, { error: "Not found." }, headers);
    return;
  }

  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 220_000) {
      send(response, 413, { error: "Diff is too large for this POC." }, headers);
      request.destroy();
      return;
    }
  }

  try {
    const body = JSON.parse(raw);
    if (!body.diff || !Array.isArray(body.inventory) || body.inventory.length === 0) {
      send(response, 400, { error: "A diff with changed-line inventory is required." }, headers);
      return;
    }

    const codex = new Codex();
    const thread = codex.startThread();
    const result = await thread.run(buildPrompt(body));
    const analysis = parseJsonResponse(result.finalResponse);
    send(response, 200, { provider: "Codex SDK · local authentication", analysis }, headers);
  } catch (error) {
    send(response, 500, {
      error: `Codex local bridge failed: ${error instanceof Error ? error.message : "unknown error"}. No OpenAI API fallback was used.`,
    }, headers);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ChangeGraph Codex bridge listening on http://127.0.0.1:${PORT}`);
});
