import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseSource } from "../local-bridge/server.mjs";

const [beforeArgument, afterArgument] = process.argv.slice(2);
if (!beforeArgument || !afterArgument) {
  console.error("Usage: node scripts/compare-graphs.mjs <before-record.json> <after-record.json>");
  process.exitCode = 1;
} else {
  const load = async (argument) => {
    const value = JSON.parse(await readFile(path.resolve(argument), "utf8"));
    return value.graph || value;
  };
  const [before, after] = await Promise.all([load(beforeArgument), load(afterArgument)]);
  const sha = (value) => createHash("sha256").update(String(value)).digest("hex");
  const normalize = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const files = (source) => {
    const result = new Map();
    let current = null;
    let lines = [];
    const flush = () => {
      if (current !== null) result.set(current, { hash: sha(lines.join("\n")), lines: lines.length });
    };
    for (const line of String(source || "").split(/\r?\n/)) {
      const match = line.match(/^===\s+(.+?)\s+===$/);
      if (match) {
        flush();
        current = match[1];
        lines = [];
      } else if (current !== null) lines.push(line);
    }
    flush();
    return result;
  };
  const metrics = (graph) => {
    const inventory = parseSource(graph.source);
    const inventoryById = new Map(inventory.map((line) => [line.id, line]));
    const covered = new Set();
    const inventoryByFile = new Map();
    const coveredByFile = new Map();
    for (const line of inventory) inventoryByFile.set(line.file, [...(inventoryByFile.get(line.file) || []), line.id]);
    const nodeFiles = new Map();
    const kinds = {};
    const identities = new Set();
    let unknownNodes = 0;
    for (const node of graph.analysis.nodes) {
      kinds[node.kind] = (kinds[node.kind] || 0) + 1;
      if (node.kind === "unknown") unknownNodes += 1;
      const identity = normalize(node.codeIdentity || node.title);
      if (identity) identities.add(identity);
      const ownedFiles = new Set();
      for (const lineId of node.lineIds || []) {
        const line = inventoryById.get(lineId);
        if (line) {
          covered.add(lineId);
          ownedFiles.add(line.file);
          coveredByFile.set(line.file, new Set([...(coveredByFile.get(line.file) || []), lineId]));
        }
      }
      nodeFiles.set(node.id, ownedFiles);
    }
    const edgeKeys = new Set();
    const conceptualEdges = new Set();
    let duplicateEdges = 0;
    let crossFileEdges = 0;
    const nodesById = new Map(graph.analysis.nodes.map((node) => [node.id, node]));
    for (const edge of graph.analysis.edges) {
      const key = `${edge.source}|${edge.target}|${normalize(edge.label)}`;
      if (edgeKeys.has(key)) duplicateEdges += 1;
      edgeKeys.add(key);
      const sourceNode = nodesById.get(edge.source);
      const targetNode = nodesById.get(edge.target);
      conceptualEdges.add(`${normalize(sourceNode?.codeIdentity || sourceNode?.title)}|${normalize(targetNode?.codeIdentity || targetNode?.title)}|${normalize(edge.label)}`);
      const sourceFiles = nodeFiles.get(edge.source) || new Set();
      const targetFiles = nodeFiles.get(edge.target) || new Set();
      if ([...sourceFiles].some((file) => !targetFiles.has(file))) crossFileEdges += 1;
    }
    const started = Date.parse(graph.createdAt);
    const completed = Date.parse(graph.updatedAt);
    return {
      durationMs: Number.isFinite(started) && Number.isFinite(completed) ? completed - started : null,
      sourceCharacters: graph.source.length,
      inventoryLines: inventory.length,
      coveredLines: covered.size,
      lineCoveragePercent: inventory.length ? Number((covered.size / inventory.length * 100).toFixed(2)) : 0,
      nodes: graph.analysis.nodes.length,
      edges: graph.analysis.edges.length,
      uniqueEdges: edgeKeys.size,
      duplicateEdges,
      crossFileEdges,
      unknownNodes,
      kinds,
      identities,
      conceptualEdges,
      inventoryByFile,
      coveredByFile,
      providerAttempts: graph.telemetry?.summary?.providerAttempts ?? null,
      usage: graph.telemetry?.summary?.usage ?? null,
      deterministicEdges: graph.deterministicEdges ?? 0,
      connectionGroups: graph.connectionGroups ?? 0,
    };
  };
  const beforeMetrics = metrics(before);
  const afterMetrics = metrics(after);
  const beforeFiles = files(before.source);
  const afterFiles = files(after.source);
  const sharedFiles = [...beforeFiles.keys()].filter((file) => afterFiles.has(file));
  const unchangedFiles = sharedFiles.filter((file) => beforeFiles.get(file).hash === afterFiles.get(file).hash);
  const changedFiles = sharedFiles.filter((file) => beforeFiles.get(file).hash !== afterFiles.get(file).hash);
  const commonIdentities = [...beforeMetrics.identities].filter((identity) => afterMetrics.identities.has(identity));
  const commonConceptualEdges = [...beforeMetrics.conceptualEdges].filter((edge) => afterMetrics.conceptualEdges.has(edge));
  const coverageForFiles = (metrics, selectedFiles) => {
    const total = selectedFiles.reduce((sum, file) => sum + (metrics.inventoryByFile.get(file)?.length || 0), 0);
    const covered = selectedFiles.reduce((sum, file) => sum + (metrics.coveredByFile.get(file)?.size || 0), 0);
    return { total, covered, percent: total ? Number((covered / total * 100).toFixed(2)) : 0 };
  };
  const usage = afterMetrics.usage || {};
  const inputTokens = Number(usage.inputTokens || 0);
  const cachedInputTokens = Number(usage.cachedInputTokens || 0);
  const outputTokens = Number(usage.outputTokens || 0);
  const estimatedCostUsd = (Math.max(0, inputTokens - cachedInputTokens) * .75 + cachedInputTokens * .075 + outputTokens * 4.5) / 1_000_000;
  const serializable = (value) => {
    const { identities, conceptualEdges, inventoryByFile, coveredByFile, ...rest } = value;
    return rest;
  };
  console.log(JSON.stringify({
    repositoryComparison: {
      beforeSnapshot: before.snapshot?.hash || null,
      afterSnapshot: after.snapshot?.hash || null,
      beforeFiles: beforeFiles.size,
      afterFiles: afterFiles.size,
      sharedFiles: sharedFiles.length,
      unchangedFiles: unchangedFiles.length,
      changedFiles: changedFiles.length,
      addedFiles: [...afterFiles.keys()].filter((file) => !beforeFiles.has(file)).length,
      removedFiles: [...beforeFiles.keys()].filter((file) => !afterFiles.has(file)).length,
      unchangedFileCoverage: {
        before: coverageForFiles(beforeMetrics, unchangedFiles),
        after: coverageForFiles(afterMetrics, unchangedFiles),
      },
    },
    before: serializable(beforeMetrics),
    after: { ...serializable(afterMetrics), estimatedApiCostUsd: Number(estimatedCostUsd.toFixed(4)) },
    overlap: {
      commonCodeIdentities: commonIdentities.length,
      beforeIdentityRetentionPercent: Number((commonIdentities.length / Math.max(1, beforeMetrics.identities.size) * 100).toFixed(2)),
      afterIdentityMatchedPercent: Number((commonIdentities.length / Math.max(1, afterMetrics.identities.size) * 100).toFixed(2)),
      exactConceptualEdgesRetained: commonConceptualEdges.length,
      beforeConceptualEdgeRetentionPercent: Number((commonConceptualEdges.length / Math.max(1, beforeMetrics.conceptualEdges.size) * 100).toFixed(2)),
    },
  }, null, 2));
}
