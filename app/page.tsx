"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";

type ProviderId = "codex-local" | "openai-api";
type ChangeKind =
  | "contract"
  | "routing"
  | "error"
  | "fallback"
  | "state"
  | "output"
  | "config"
  | "test"
  | "unknown";

type ChangedLine = {
  id: string;
  side: "old" | "new";
  file: string;
  lineNumber: number;
  text: string;
};

type ChangeNodeData = Record<string, unknown> & {
  title: string;
  kind: ChangeKind;
  before: string;
  after: string;
  beforeCode: string;
  afterCode: string;
  lineIds: string[];
  confidence: "high" | "medium" | "low";
};

type ChangeNode = Node<ChangeNodeData, "semantic">;

type AnalysisResult = {
  nodes: ChangeNode[];
  edges: Edge[];
  inventory: ChangedLine[];
  covered: number;
  unknown: number;
  source: string;
};

type AiNode = {
  id: string;
  title: string;
  kind: ChangeKind;
  before: string;
  after: string;
  lineIds: string[];
  confidence: "high" | "medium" | "low";
};

type AiAnalysis = {
  nodes: AiNode[];
  edges: Array<{ source: string; target: string; label: string }>;
};

const SAMPLE_DIFF = `diff --git a/src/pricing.foo b/src/pricing.foo
index 6f80a21..891ba31 100644
--- a/src/pricing.foo
+++ b/src/pricing.foo
@@ -12,18 +12,34 @@ class PricingService {
-  constructor(primary) {
+  constructor(primary, backup, cache) {
     this.primary = primary
+    this.backup = backup
+    this.cache = cache
   }

   getPrice(request) {
     try {
       return this.primary.getPrice(request)
-    } catch {
-      return unavailable()
+    } catch (error) {
+      if (!(error instanceof TimeoutError)) {
+        throw error
+      }
+
+      try {
+        return this.backup.getPrice(request)
+      } catch (backupError) {
+        const cached = this.cache.getRecent(request.sku, 5 * MINUTE)
+        if (cached) return cached
+        return unavailable()
+      }
     }
   }
 }
diff --git a/config/pricing.env b/config/pricing.env
index 1c82588..7b6fa39 100644
--- a/config/pricing.env
+++ b/config/pricing.env
@@ -1,2 +1,3 @@
-PRIMARY_TIMEOUT_MS=2000
+PRIMARY_TIMEOUT_MS=1200
+BACKUP_TIMEOUT_MS=800
 CACHE_MAX_AGE_MS=300000
diff --git a/tests/pricing.foo b/tests/pricing.foo
index 7031ca1..e7770bd 100644
--- a/tests/pricing.foo
+++ b/tests/pricing.foo
@@ -18,3 +18,13 @@ test "primary success" {
   expect(result).equals(42)
 }
+
+test "timeout uses backup" {
+  primary.throws(TimeoutError)
+  backup.returns(41)
+  expect(service.getPrice(request)).equals(41)
+}
+
+test "backup failure uses recent cache" {
+  backup.throws(NetworkError)
+  expect(service.getPrice(request)).equals(cachedPrice)
+}`;

const NODE_META: Record<
  ChangeKind,
  { eyebrow: string; before: string; after: string; confidence: "high" | "medium" | "low" }
> = {
  contract: {
    eyebrow: "Dependency contract",
    before: "Primary provider only",
    after: "Primary + backup + cache",
    confidence: "high",
  },
  routing: {
    eyebrow: "Error routing",
    before: "Every error collapses",
    after: "Timeout branches; others escape",
    confidence: "high",
  },
  error: {
    eyebrow: "Error output",
    before: "Return unavailable",
    after: "Throw non-timeout error",
    confidence: "high",
  },
  fallback: {
    eyebrow: "New fallback",
    before: "No secondary provider",
    after: "Call backup provider",
    confidence: "high",
  },
  state: {
    eyebrow: "New state read",
    before: "No cache lookup",
    after: "Read cache after backup failure",
    confidence: "high",
  },
  output: {
    eyebrow: "Output reachability",
    before: "Unavailable after first failure",
    after: "Unavailable after both fallbacks",
    confidence: "medium",
  },
  config: {
    eyebrow: "Runtime configuration",
    before: "Primary timeout: 2000 ms",
    after: "Primary: 1200 ms; backup: 800 ms",
    confidence: "high",
  },
  test: {
    eyebrow: "Behavior evidence",
    before: "Primary success only",
    after: "Backup + cache scenarios added",
    confidence: "high",
  },
  unknown: {
    eyebrow: "Unclassified lines",
    before: "Meaning not established",
    after: "Human inspection required",
    confidence: "low",
  },
};

const NODE_POSITIONS: Record<ChangeKind, { x: number; y: number }> = {
  contract: { x: 0, y: 150 },
  routing: { x: 250, y: 150 },
  error: { x: 500, y: 0 },
  fallback: { x: 500, y: 150 },
  state: { x: 750, y: 150 },
  output: { x: 750, y: 320 },
  config: { x: 500, y: 320 },
  test: { x: 250, y: 320 },
  unknown: { x: 0, y: 320 },
};

function parseDiff(diff: string): ChangedLine[] {
  const inventory: ChangedLine[] = [];
  let file = "unknown";
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("+++ ")) {
      const path = rawLine.slice(4).trim();
      file = path === "/dev/null" ? file : path.replace(/^b\//, "");
      continue;
    }

    const hunk = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }

    if (rawLine.startsWith("diff --git") || rawLine.startsWith("index ") || rawLine.startsWith("--- ")) {
      continue;
    }

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      inventory.push({
        id: `new:${file}:${newLine}`,
        side: "new",
        file,
        lineNumber: newLine,
        text: rawLine.slice(1),
      });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      inventory.push({
        id: `old:${file}:${oldLine}`,
        side: "old",
        file,
        lineNumber: oldLine,
        text: rawLine.slice(1),
      });
      oldLine += 1;
      continue;
    }

    if (rawLine.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }

  return inventory;
}

function classifyLine(line: ChangedLine): ChangeKind {
  const path = line.file.toLowerCase();
  const text = line.text.toLowerCase();

  if (path.includes("test") || /\b(test|expect|assert|mock)\b/.test(text)) return "test";
  if (path.includes("config") || path.endsWith(".env") || text.includes("timeout_ms")) return "config";
  if (text.includes("backup")) return "fallback";
  if (text.includes("cache") || text.includes("cached")) return "state";
  if (text.includes("throw ")) return "error";
  if (text.includes("timeouterror") || text.includes("catch")) return "routing";
  if (text.includes("unavailable")) return "output";
  if (text.includes("constructor") || text.includes("this.primary")) return "contract";
  return "unknown";
}

function formatCode(lines: ChangedLine[], side: "old" | "new") {
  const selected = lines
    .filter((line) => line.side === side)
    .sort((a, b) => a.file.localeCompare(b.file) || a.lineNumber - b.lineNumber);

  if (!selected.length) return side === "old" ? "// did not exist" : "// removed";

  let previousFile = "";
  return selected
    .map((line) => {
      const fileHeader = line.file !== previousFile ? `${line.file}\n` : "";
      previousFile = line.file;
      const marker = side === "old" ? "−" : "+";
      return `${fileHeader}${String(line.lineNumber).padStart(3, " ")} ${marker} ${line.text}`;
    })
    .join("\n");
}

function makeEdge(source: string, target: string, label: string, color = "#8fa2bf"): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    label,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color },
    style: { stroke: color, strokeWidth: 1.6 },
    labelStyle: { fill: "#aebbd0", fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: "#101722", fillOpacity: 0.9 },
  };
}

function createGraph(diff: string, source = "POC demo engine"): AnalysisResult {
  const inventory = parseDiff(diff);
  const groups = new Map<ChangeKind, ChangedLine[]>();

  for (const line of inventory) {
    const kind = classifyLine(line);
    groups.set(kind, [...(groups.get(kind) ?? []), line]);
  }

  const nodes: ChangeNode[] = [...groups.entries()].map(([kind, lines]) => {
    const meta = NODE_META[kind];
    return {
      id: kind,
      type: "semantic",
      position: NODE_POSITIONS[kind],
      data: {
        title: meta.eyebrow,
        kind,
        before: meta.before,
        after: meta.after,
        beforeCode: formatCode(lines, "old"),
        afterCode: formatCode(lines, "new"),
        lineIds: lines.map((line) => line.id),
        confidence: meta.confidence,
      },
    };
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const candidates = [
    makeEdge("contract", "routing", "CHANGES INPUTS", "#6f8cff"),
    makeEdge("routing", "error", "OTHER ERRORS", "#f3998e"),
    makeEdge("routing", "fallback", "ON TIMEOUT", "#70d6b0"),
    makeEdge("fallback", "state", "ON FAILURE", "#70d6b0"),
    makeEdge("state", "output", "CACHE MISS", "#70d6b0"),
    makeEdge("config", "fallback", "CONFIGURES", "#d7ae68"),
    makeEdge("fallback", "test", "TESTED BY", "#8fa2bf"),
    makeEdge("state", "test", "TESTED BY", "#8fa2bf"),
  ];

  const edges = candidates.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const unknown = groups.get("unknown")?.length ?? 0;

  return {
    nodes,
    edges,
    inventory,
    covered: inventory.length,
    unknown,
    source,
  };
}

function materializeAiGraph(diff: string, ai: AiAnalysis, source: string): AnalysisResult {
  const inventory = parseDiff(diff);
  const inventoryById = new Map(inventory.map((line) => [line.id, line]));
  const claimed = new Set<string>();
  const normalizedIds = new Map<string, string>();

  const cleanNodes = (Array.isArray(ai.nodes) ? ai.nodes : []).map((rawNode, index) => {
    const id = `ai-${index}-${String(rawNode.id || "change").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
    normalizedIds.set(rawNode.id, id);
    const lineIds = (Array.isArray(rawNode.lineIds) ? rawNode.lineIds : []).filter((lineId) => {
      if (!inventoryById.has(lineId) || claimed.has(lineId)) return false;
      claimed.add(lineId);
      return true;
    });
    const lines = lineIds.map((lineId) => inventoryById.get(lineId)!).filter(Boolean);
    const kind: ChangeKind = Object.prototype.hasOwnProperty.call(NODE_META, rawNode.kind) ? rawNode.kind : "unknown";

    return {
      id,
      type: "semantic" as const,
      position: { x: (index % 4) * 310, y: Math.floor(index / 4) * 230 + (index % 2) * 34 },
      data: {
        title: rawNode.title || "Semantic change",
        kind,
        before: rawNode.before || "Earlier behavior",
        after: rawNode.after || "New behavior",
        beforeCode: formatCode(lines, "old"),
        afterCode: formatCode(lines, "new"),
        lineIds,
        confidence: rawNode.confidence || "medium",
      },
    } satisfies ChangeNode;
  }).filter((node) => node.data.lineIds.length > 0);

  const unclaimed = inventory.filter((line) => !claimed.has(line.id));
  if (unclaimed.length) {
    cleanNodes.push({
      id: "ai-unclassified",
      type: "semantic",
      position: { x: 0, y: Math.ceil(cleanNodes.length / 4) * 230 + 80 },
      data: {
        title: "Unclassified lines",
        kind: "unknown",
        before: "Meaning not established",
        after: "Human inspection required",
        beforeCode: formatCode(unclaimed, "old"),
        afterCode: formatCode(unclaimed, "new"),
        lineIds: unclaimed.map((line) => line.id),
        confidence: "low",
      },
    });
  }

  const validNodeIds = new Set(cleanNodes.map((node) => node.id));
  const edges = (Array.isArray(ai.edges) ? ai.edges : [])
    .map((edge, index) => ({
      ...makeEdge(
        normalizedIds.get(edge.source) ?? edge.source,
        normalizedIds.get(edge.target) ?? edge.target,
        edge.label || "RELATES TO",
      ),
      id: `ai-edge-${index}`,
    }))
    .filter((edge) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target));

  return {
    nodes: cleanNodes,
    edges,
    inventory,
    covered: inventory.length,
    unknown: unclaimed.length,
    source,
  };
}

function SemanticNodeView({ data, selected }: NodeProps<ChangeNode>) {
  return (
    <div className={`semantic-node kind-${data.kind} ${selected ? "is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-topline">
        <span>{data.title}</span>
        <span className={`confidence confidence-${data.confidence}`}>{data.confidence}</span>
      </div>
      <div className="node-change">
        <span className="node-before">{data.before}</span>
        <span className="node-arrow">→</span>
        <span className="node-after">{data.after}</span>
      </div>
      <div className="node-lines">{data.lineIds.length} changed lines</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { semantic: SemanticNodeView };

export default function Home() {
  const [diff, setDiff] = useState(SAMPLE_DIFF);
  const [task, setTask] = useState("Add a resilient pricing fallback for provider timeouts.");
  const [provider, setProvider] = useState<ProviderId>("codex-local");
  const [pocMode, setPocMode] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResult>(() => createGraph(SAMPLE_DIFF));
  const [selectedId, setSelectedId] = useState("routing");
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("complete");
  const [message, setMessage] = useState("Sample analysis ready. Select any graph node.");
  const [mobilePanel, setMobilePanel] = useState<"input" | "graph" | "inspect">("graph");

  const selectedNode = useMemo(
    () => analysis.nodes.find((node) => node.id === selectedId) ?? analysis.nodes[0],
    [analysis, selectedId],
  );

  const runAnalysis = useCallback(async () => {
    setStatus("running");
    setMessage(pocMode ? "Mapping every changed line into semantic nodes…" : "Calling selected AI provider…");

    try {
      if (pocMode) {
        await new Promise((resolve) => setTimeout(resolve, 550));
        const result = createGraph(
          diff,
          provider === "codex-local" ? "Codex local · simulated" : "OpenAI API · simulated",
        );
        setAnalysis(result);
        setSelectedId(result.nodes.find((node) => node.id === "routing")?.id ?? result.nodes[0]?.id ?? "");
        setMessage("All changed lines mapped. POC mode made no external AI call.");
        setStatus("complete");
        setMobilePanel("graph");
        return;
      }

      const inventory = parseDiff(diff);
      const endpoint = provider === "codex-local" ? "http://127.0.0.1:47831/analyze" : "/api/analyze";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, diff, task, inventory }),
      });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error ?? "Analysis provider failed.");

      if (!payload.analysis) throw new Error("The provider returned no semantic analysis.");
      const result = materializeAiGraph(diff, payload.analysis, payload.provider ?? provider);
      setAnalysis(result);
      setSelectedId(result.nodes[0]?.id ?? "");
      setMessage(`Provider call completed. ${result.covered - result.unknown}/${result.covered} lines classified; exact code remains grounded in the diff.`);
      setStatus("complete");
      setMobilePanel("graph");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Analysis failed.");
    }
  }, [diff, pocMode, provider, task]);

  return (
    <main className="app-shell">
      <header className="product-header">
        <div className="brand-block">
          <div className="brand-mark">CG</div>
          <div>
            <div className="brand-name">ChangeGraph</div>
            <div className="brand-subtitle">Understand every line your coding agent changed</div>
          </div>
        </div>
        <div className="header-status">
          <div className="status-stat">
            <span>Line accounting</span>
            <strong>{analysis.covered} / {analysis.inventory.length}</strong>
          </div>
          <div className={`status-stat ${analysis.unknown ? "has-warning" : ""}`}>
            <span>Unclassified</span>
            <strong>{analysis.unknown}</strong>
          </div>
          <div className="provider-badge">{analysis.source}</div>
        </div>
      </header>

      <nav className="mobile-nav" aria-label="Change review sections">
        <button type="button" className={mobilePanel === "input" ? "active" : ""} onClick={() => setMobilePanel("input")}>
          <span>01</span> Input
        </button>
        <button type="button" className={mobilePanel === "graph" ? "active" : ""} onClick={() => setMobilePanel("graph")}>
          <span>02</span> Graph
        </button>
        <button type="button" className={mobilePanel === "inspect" ? "active" : ""} onClick={() => setMobilePanel("inspect")}>
          <span>03</span> Details
          {selectedNode ? <i>{selectedNode.data.lineIds.length}</i> : null}
        </button>
      </nav>

      <div className={`workspace mobile-panel-${mobilePanel}`}>
        <aside className="input-panel">
          <div className="panel-heading">
            <span className="step-number">01</span>
            <div>
              <h1>Analyze a code change</h1>
              <p>Paste a unified diff. Every added and deleted line receives one graph owner.</p>
            </div>
          </div>

          <fieldset className="provider-fieldset">
            <legend>AI execution</legend>
            <button
              type="button"
              className={`provider-option ${provider === "codex-local" ? "selected" : ""}`}
              onClick={() => setProvider("codex-local")}
              aria-pressed={provider === "codex-local"}
            >
              <span className="provider-icon codex-icon">C</span>
              <span><strong>Codex local</strong><small>Use local authentication</small></span>
              <span className="provider-state">Bridge</span>
            </button>
            <button
              type="button"
              className={`provider-option ${provider === "openai-api" ? "selected" : ""}`}
              onClick={() => setProvider("openai-api")}
              aria-pressed={provider === "openai-api"}
            >
              <span className="provider-icon api-icon">API</span>
              <span><strong>OpenAI API</strong><small>Use server-side API key</small></span>
              <span className="provider-state">Env</span>
            </button>
          </fieldset>

          <label className="poc-toggle" htmlFor="poc-mode">
            <span className="sr-only">Toggle POC demo mode</span>
            <input id="poc-mode" type="checkbox" checked={pocMode} onChange={(event) => setPocMode(event.target.checked)} />
            <span className="toggle-track"><span /></span>
            <span><strong>POC demo mode</strong><small>No external call; deterministic graph fixture</small></span>
          </label>

          <label className="field-label" htmlFor="task">Original task <span>optional</span></label>
          <textarea
            id="task"
            className="task-input"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            rows={2}
          />

          <div className="diff-label-row">
            <label className="field-label" htmlFor="diff">Unified diff</label>
            <button type="button" className="text-action" onClick={() => setDiff(SAMPLE_DIFF)}>Load sample</button>
          </div>
          <textarea
            id="diff"
            className="diff-input"
            value={diff}
            onChange={(event) => setDiff(event.target.value)}
            spellCheck={false}
          />

          <button type="button" className="analyze-button" onClick={runAnalysis} disabled={status === "running" || !diff.trim()}>
            <span>{status === "running" ? "Analyzing…" : pocMode ? "Build semantic graph" : `Analyze with ${provider === "codex-local" ? "Codex" : "OpenAI"}`}</span>
            <span aria-hidden="true">↗</span>
          </button>
          <div className={`run-message message-${status}`} role="status">{message}</div>
        </aside>

        <section className="graph-panel" aria-label="Semantic change graph">
          <div className="graph-header">
            <div>
              <span className="section-kicker">02 · Semantic change graph</span>
              <h2>What changed, from what, and what happens next</h2>
            </div>
            <div className="legend" aria-label="Graph legend">
              <span><i className="legend-dot changed" />Changed</span>
              <span><i className="legend-dot added" />Added</span>
              <span><i className="legend-dot evidence" />Evidence</span>
            </div>
          </div>
          <div className="graph-canvas">
            <ReactFlow
              nodes={analysis.nodes}
              edges={analysis.edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => {
                setSelectedId(node.id);
                setMobilePanel("inspect");
              }}
              fitView
              fitViewOptions={{ padding: 0.08 }}
              minZoom={0.35}
              maxZoom={1.7}
              proOptions={{ hideAttribution: true }}
              aria-label="Node and edge graph of semantic code changes"
            >
              <Background color="#2a3a50" gap={22} size={1} variant={BackgroundVariant.Dots} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) => node.id === "fallback" || node.id === "state" ? "#2f9e7d" : node.id === "test" ? "#8a6f3d" : "#526986"}
                maskColor="rgba(8, 13, 20, 0.72)"
              />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="panel-heading compact">
            <span className="step-number">03</span>
            <div><h2>Exact transformation</h2><p>Select a node to inspect its owned lines.</p></div>
          </div>

          {selectedNode ? (
            <div className="inspector-content">
              <div className="inspector-meta">
                <span className={`kind-chip kind-${selectedNode.data.kind}`}>{selectedNode.data.title}</span>
                <span className={`confidence-chip confidence-${selectedNode.data.confidence}`}>{selectedNode.data.confidence} confidence</span>
              </div>
              <div className="transformation-summary">
                <div><span>Before</span><strong>{selectedNode.data.before}</strong></div>
                <div className="transform-arrow">↓</div>
                <div><span>After</span><strong>{selectedNode.data.after}</strong></div>
              </div>

              <section className="code-block removed-code">
                <div className="code-title"><span>From</span><span>{selectedNode.data.lineIds.filter((id) => id.startsWith("old:")).length} deleted lines</span></div>
                <pre>{selectedNode.data.beforeCode}</pre>
              </section>
              <section className="code-block added-code">
                <div className="code-title"><span>To</span><span>{selectedNode.data.lineIds.filter((id) => id.startsWith("new:")).length} added lines</span></div>
                <pre>{selectedNode.data.afterCode}</pre>
              </section>

              <details className="line-ledger">
                <summary>Owned line IDs <span>{selectedNode.data.lineIds.length}</span></summary>
                <div>{selectedNode.data.lineIds.map((id) => <code key={id}>{id}</code>)}</div>
              </details>
            </div>
          ) : (
            <div className="empty-inspector">Run an analysis and select a node.</div>
          )}
        </aside>
      </div>
    </main>
  );
}
