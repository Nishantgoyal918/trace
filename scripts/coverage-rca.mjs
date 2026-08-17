import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { buildBatches, parseSource } from "../local-bridge/server.mjs";

const argument = process.argv[2];
if (!argument) throw new Error("Usage: node scripts/coverage-rca.mjs <persisted-graph-record.json>");
const record = JSON.parse(await readFile(path.resolve(argument), "utf8"));
const graph = record.graph || record;
const inventory = parseSource(graph.source);
function buildV10Batches(lines) {
  const byFile = new Map();
  for (const line of lines) byFile.set(line.file, [...(byFile.get(line.file) || []), line]);
  const segments = [];
  for (const fileLines of byFile.values()) {
    let current = [];
    let characters = 0;
    for (const line of fileLines) {
      const size = line.id.length + line.text.length + 8;
      if (current.length && (current.length >= 180 || characters + size > 18_000)) {
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
    if (current.length && (current.length + segment.length > 180 || characters + size > 18_000)) {
      packed.push(current);
      current = [];
      characters = 0;
    }
    current.push(...segment);
    characters += size;
  }
  if (current.length) packed.push(current);
  return packed.map((batch) => ({
    id: `leaf-${createHash("sha256").update(batch.map((line) => `${line.id}\n${line.text}`).join("\n")).digest("hex").slice(0, 16)}`,
    files: [...new Set(batch.map((line) => line.file))],
    inventory: batch,
    content: batch.map((line) => `[${line.id}] ${line.text}`).join("\n"),
  }));
}
const batches = String(graph.snapshot?.promptVersion || "").includes("semantic-v10")
  ? buildV10Batches(inventory)
  : buildBatches(inventory);
const validById = new Map(inventory.map((line) => [line.id, line]));

function recoverLineIds(value) {
  const exact = validById.has(value) ? [value] : [];
  if (exact.length) return { kind: "exact", ids: exact };
  const bare = String(value).match(/^(.+):(\d+)$/);
  if (bare) {
    const id = `source:${bare[1]}:${bare[2]}`;
    if (validById.has(id)) return { kind: "missing-source-prefix", ids: [id] };
  }
  const range = String(value).match(/^(?:inventory:)?(.+):(\d+)-(\d+)$/);
  if (range) {
    const ids = [];
    for (let line = Number(range[2]); line <= Number(range[3]); line += 1) {
      const id = `source:${range[1]}:${line}`;
      if (validById.has(id)) ids.push(id);
    }
    if (ids.length) return { kind: "compressed-range", ids };
  }
  if (/^inventory(?:-id|-\d+)$/.test(String(value))) return { kind: "invented-placeholder", ids: [] };
  return { kind: "other-invalid", ids: [] };
}

const nodesByBatch = new Map();
for (const node of graph.analysis.nodes) {
  const match = String(node.id).match(/^batch-(\d+)-/);
  const batchIndex = match ? Number(match[1]) : -1;
  nodesByBatch.set(batchIndex, [...(nodesByBatch.get(batchIndex) || []), node]);
}
const completedTelemetry = new Map(graph.telemetry.events
  .filter((event) => event.phase === "semantic" && event.state === "completed")
  .map((event) => [event.leafUnitId, event]));

const invalidKinds = {};
const fileStats = new Map();
const extensionStats = new Map();
const leafStats = batches.map((batch, batchIndex) => {
  const expected = new Set(batch.inventory.map((line) => line.id));
  const exact = new Set();
  const recoverable = new Set();
  const invalidValues = new Set();
  const nodes = nodesByBatch.get(batchIndex) || [];
  for (const node of nodes) {
    for (const value of node.lineIds || []) {
      const recovered = recoverLineIds(value);
      invalidKinds[recovered.kind] = (invalidKinds[recovered.kind] || 0) + (recovered.kind === "exact" ? 0 : 1);
      if (recovered.kind !== "exact") invalidValues.add(value);
      for (const id of recovered.ids) {
        if (!expected.has(id)) continue;
        recoverable.add(id);
        if (recovered.kind === "exact") exact.add(id);
      }
    }
  }
  const missing = [...expected].filter((id) => !recoverable.has(id));
  const telemetry = completedTelemetry.get(batch.id);
  const outputTokens = Number(telemetry?.usage?.output_tokens || 0);
  const result = {
    batchIndex,
    leafUnitId: batch.id,
    files: batch.files,
    lines: expected.size,
    characters: batch.content.length,
    nodes: nodes.length,
    exact: exact.size,
    recoverable: recoverable.size,
    missing: missing.length,
    exactPercent: Number((exact.size / expected.size * 100).toFixed(2)),
    recoverablePercent: Number((recoverable.size / expected.size * 100).toFixed(2)),
    invalidValues: invalidValues.size,
    outputTokens,
    outputTokensPerExpectedLine: Number((outputTokens / expected.size).toFixed(2)),
  };
  for (const line of batch.inventory) {
    const file = line.file;
    const stat = fileStats.get(file) || { file, total: 0, exact: 0, recoverable: 0, missing: 0 };
    stat.total += 1;
    stat.exact += exact.has(line.id) ? 1 : 0;
    stat.recoverable += recoverable.has(line.id) ? 1 : 0;
    stat.missing += recoverable.has(line.id) ? 0 : 1;
    fileStats.set(file, stat);
    const extension = path.extname(file).toLowerCase() || "[none]";
    const extensionStat = extensionStats.get(extension) || { extension, total: 0, recoverable: 0, missing: 0 };
    extensionStat.total += 1;
    extensionStat.recoverable += recoverable.has(line.id) ? 1 : 0;
    extensionStat.missing += recoverable.has(line.id) ? 0 : 1;
    extensionStats.set(extension, extensionStat);
  }
  return result;
});

const correlation = (left, right) => {
  const pairs = leafStats.map((item) => [item[left], item[right]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const averageA = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length;
  const averageB = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length;
  const numerator = pairs.reduce((sum, [a, b]) => sum + (a - averageA) * (b - averageB), 0);
  const denominatorA = Math.sqrt(pairs.reduce((sum, [a]) => sum + (a - averageA) ** 2, 0));
  const denominatorB = Math.sqrt(pairs.reduce((sum, [, b]) => sum + (b - averageB) ** 2, 0));
  return Number((numerator / (denominatorA * denominatorB || 1)).toFixed(3));
};
const withPercent = (item) => ({ ...item, recoverablePercent: Number((item.recoverable / item.total * 100).toFixed(2)) });
const total = leafStats.reduce((summary, leaf) => {
  for (const key of ["lines", "exact", "recoverable", "missing", "nodes", "invalidValues", "outputTokens"]) summary[key] += leaf[key];
  return summary;
}, { lines: 0, exact: 0, recoverable: 0, missing: 0, nodes: 0, invalidValues: 0, outputTokens: 0 });

console.log(JSON.stringify({
  jobId: graph.id,
  summary: {
    ...total,
    exactPercent: Number((total.exact / total.lines * 100).toFixed(2)),
    recoverablePercent: Number((total.recoverable / total.lines * 100).toFixed(2)),
    leavesBelow95Percent: leafStats.filter((leaf) => leaf.recoverablePercent < 95).length,
    leavesBelow80Percent: leafStats.filter((leaf) => leaf.recoverablePercent < 80).length,
    leavesAtZeroPercent: leafStats.filter((leaf) => leaf.recoverablePercent === 0).length,
    leavesAt100Percent: leafStats.filter((leaf) => leaf.recoverablePercent === 100).length,
  },
  invalidKinds,
  correlationsWithRecoverableCoverage: {
    lines: correlation("lines", "recoverablePercent"),
    characters: correlation("characters", "recoverablePercent"),
    nodes: correlation("nodes", "recoverablePercent"),
    invalidValues: correlation("invalidValues", "recoverablePercent"),
    outputTokensPerExpectedLine: correlation("outputTokensPerExpectedLine", "recoverablePercent"),
  },
  worstLeaves: [...leafStats].sort((a, b) => a.recoverablePercent - b.recoverablePercent).slice(0, 20),
  bestLeaves: [...leafStats].sort((a, b) => b.recoverablePercent - a.recoverablePercent).slice(0, 10),
  worstFiles: [...fileStats.values()].filter((item) => item.total >= 10).map(withPercent).sort((a, b) => a.recoverablePercent - b.recoverablePercent || b.total - a.total).slice(0, 30),
  extensions: [...extensionStats.values()].map(withPercent).sort((a, b) => a.recoverablePercent - b.recoverablePercent),
}, null, 2));
