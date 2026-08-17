import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCoverageRepair,
  buildBatches,
  deterministicContractEdges,
  finalizeUnknownCoverage,
  hasUnresolvedContracts,
  normalizeContractResource,
  telemetrySummary,
  validateAnalysisCoverage,
} from "../local-bridge/server.mjs";

test("pre-sizes stable leaf work for the global scheduler", () => {
  const inventory = Array.from({ length: 425 }, (_, index) => ({
    id: `source:large.py:${index + 1}`,
    file: "large.py",
    lineNumber: index + 1,
    text: `value_${index} = ${"x".repeat(80)}`,
  }));
  const first = buildBatches(inventory);
  const second = buildBatches(inventory);
  assert.ok(first.length >= 3);
  assert.deepEqual(first.map((leaf) => leaf.id), second.map((leaf) => leaf.id));
  assert.ok(first.every((leaf) => leaf.inventory.length <= 120));
  assert.ok(first.every((leaf) => leaf.content.length <= 14_000));
  assert.ok(first.every((leaf) => leaf.inventory[0].ref === "L0001"));
  assert.ok(first.every((leaf) => /^\[L0001\] /.test(leaf.content)));
  assert.equal(first.reduce((total, leaf) => total + leaf.inventory.length, 0), inventory.length);
});

test("keeps language-agnostic work units inside a single file boundary", () => {
  const inventory = [
    { id: "source:a.py:1", file: "a.py", lineNumber: 1, text: "a = 1" },
    { id: "source:b.ts:1", file: "b.ts", lineNumber: 1, text: "const b = 1" },
  ];
  const batches = buildBatches(inventory);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map((batch) => batch.files), [["a.py"], ["b.ts"]]);
});

test("validates compact evidence spans and rejects invented ownership", () => {
  const inventory = Array.from({ length: 5 }, (_, index) => ({
    id: `source:sample.py:${index + 1}`,
    ref: `L${String(index + 1).padStart(4, "0")}`,
    file: "sample.py",
    lineNumber: index + 1,
  }));
  const validated = validateAnalysisCoverage({
    nodes: [
      { id: "one", title: "First", lineRefs: ["L0001-L0003"], kind: "flow" },
      { id: "bad", title: "Bad", lineRefs: ["inventory-id", "L0003"], kind: "flow" },
    ],
    edges: [],
  }, inventory);
  assert.deepEqual(validated.analysis.nodes[0].lineIds, inventory.slice(0, 3).map((line) => line.id));
  assert.equal(validated.coverage.assigned, 3);
  assert.equal(validated.coverage.invalidReferences, 1);
  assert.equal(validated.coverage.duplicateReferences, 1);
  assert.deepEqual(validated.missingInventory.map((line) => line.ref), ["L0004", "L0005"]);
});

test("repairs missing evidence and makes unresolved ownership explicit", () => {
  const inventory = Array.from({ length: 4 }, (_, index) => ({
    id: `source:sample.py:${index + 1}`,
    ref: `L${String(index + 1).padStart(4, "0")}`,
    file: "sample.py",
    lineNumber: index + 1,
  }));
  const initial = validateAnalysisCoverage({
    nodes: [{ id: "existing", title: "Existing", lineRefs: ["L0001"], kind: "flow" }],
    edges: [],
  }, inventory);
  const repaired = applyCoverageRepair(initial, {
    existingAssignments: [{ nodeId: "existing", lineRefs: ["L0002"] }],
    newNodes: [{ id: "new", title: "New", lineRefs: ["L0003"], kind: "fallback" }],
    edges: [],
  }, inventory);
  assert.equal(repaired.coverage.assigned, 3);
  const finalized = finalizeUnknownCoverage(repaired, inventory);
  assert.equal(finalized.coverage.assigned, 4);
  assert.equal(finalized.coverage.unknown, 1);
  assert.equal(finalized.analysis.nodes.at(-1).kind, "unknown");
  assert.deepEqual(finalized.analysis.nodes.at(-1).lineIds, ["source:sample.py:4"]);
});

test("builds typed deterministic edges with normalized route parameters", () => {
  const nodes = [
    { id: "client", provides: [], uses: ["HTTP GET /api/jobs/:jobId", "QUEUE PUBLISH catalog-events"] },
    { id: "endpoint", provides: ["HTTP GET /api/jobs/{id}"], uses: [] },
    { id: "worker", provides: ["QUEUE CONSUME catalog-events"], uses: [] },
  ];
  const result = deterministicContractEdges(nodes);
  assert.equal(result.edges.length, 2);
  assert.ok(result.edges.some((edge) => edge.source === "client" && edge.target === "endpoint" && edge.origin === "deterministic-contract"));
  assert.ok(result.edges.some((edge) => edge.source === "client" && edge.target === "worker"));
  assert.ok(result.edges.every((edge) => edge.confidence === "high" && edge.evidence.length === 1));
  assert.equal(hasUnresolvedContracts(nodes[0], result.resolvedRefs), false);
  assert.equal(normalizeContractResource("/api/jobs/[jobId]/"), "/api/jobs/{param}");
});

test("summarizes provider latency, retries, cache hits, and token usage", () => {
  const summary = telemetrySummary({
    total: 3,
    telemetry: { events: [
      { phase: "semantic", leafUnitId: "one", state: "queued", at: "2026-01-01T00:00:00.000Z" },
      { phase: "semantic", leafUnitId: "one", state: "started", attempt: 1, splitDepth: 0, startedAt: "2026-01-01T00:00:00.050Z" },
      { state: "completed", durationMs: 100, usage: { input_tokens: 10, output_tokens: 2 } },
      { state: "failed", durationMs: 200, failureCategory: "transport" },
      { state: "completed", durationMs: 300, usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 4 } },
      { state: "cache-hit" },
    ] },
  });
  assert.equal(summary.providerAttempts, 3);
  assert.equal(summary.failedProviderAttempts, 1);
  assert.equal(summary.cacheHits, 1);
  assert.deepEqual(summary.latencyMs, { p50: 100, p95: 300, max: 300 });
  assert.deepEqual(summary.queueWaitMs, { p50: 50, p95: 50, max: 50 });
  assert.deepEqual(summary.usage, { inputTokens: 30, cachedInputTokens: 5, outputTokens: 6, reasoningTokens: 0 });
});
