import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the ChangeGraph application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ChangeGraph/);
  assert.match(html, /Understand every line your coding agent changed/);
  assert.match(html, /Analyze a code change/);
  assert.match(html, /Semantic change graph/);
  assert.match(html, /Exact transformation/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps both AI provider paths explicit", async () => {
  const [page, route, bridge, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../local-bridge/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Codex local/);
  assert.match(page, /OpenAI API/);
  assert.match(page, /No external call; deterministic graph fixture/);
  assert.match(route, /OPENAI_API_KEY/);
  assert.match(route, /No fallback provider was used/);
  assert.match(bridge, /@openai\/codex-sdk/);
  assert.match(bridge, /No OpenAI API fallback was used/);
  assert.match(packageJson, /"codex:bridge"/);
});
