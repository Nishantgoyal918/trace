import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildBatches,
  deterministicContractEdges,
  hasUnresolvedContracts,
  parseSource,
} from "../local-bridge/server.mjs";

const recordArgument = process.argv[2];
if (!recordArgument) {
  console.error("Usage: node scripts/benchmark-pipeline.mjs <persisted-graph-record.json>");
  process.exitCode = 1;
} else {
  const recordPath = path.resolve(recordArgument);
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  const graph = record.graph || record;
  if (typeof graph.source !== "string" || !Array.isArray(graph.analysis?.nodes)) {
    throw new Error("The supplied file is not a persisted Trace graph record.");
  }
  const inventory = parseSource(graph.source);
  const leaves = buildBatches(inventory);
  const deterministic = deterministicContractEdges(graph.analysis.nodes);
  const unresolvedNodes = graph.analysis.nodes.filter((node) => hasUnresolvedContracts(node, deterministic.resolvedRefs));
  const previousSemanticCalls = Number(graph.telemetry?.summary?.successfulProviderAttempts || 165);
  const previousConnectionCalls = Number(graph.connectionGroups || 0);
  const maxAiConnectionWindows = 20;
  console.log(JSON.stringify({
    graphId: graph.id,
    repository: graph.repository?.name || null,
    sourceCharacters: graph.source.length,
    inventoryLines: inventory.length,
    previous: {
      displayedWorkUnits: graph.total,
      estimatedSemanticCalls: previousSemanticCalls,
      aiConnectionCalls: previousConnectionCalls,
    },
    optimizedDryRun: {
      globallySchedulableLeaves: leaves.length,
      deterministicEdges: deterministic.edges.length,
      nodesWithAmbiguousOrNoContracts: unresolvedNodes.length,
      maximumAiConnectionCalls: maxAiConnectionWindows,
      maximumAvoidedConnectionCalls: Math.max(0, previousConnectionCalls - maxAiConnectionWindows),
    },
  }, null, 2));
}
