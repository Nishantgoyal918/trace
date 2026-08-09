"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import Editor, { DiffEditor, loader, type DiffOnMount, type OnMount } from "@monaco-editor/react";
import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileSearch2,
  FolderGit2,
  FolderOpen,
  FolderTree,
  GitCompareArrows,
  LayoutDashboard,
  Maximize2,
  Network,
  PanelBottomClose,
  PanelRightClose,
  PanelRightOpen,
  Workflow,
  X,
} from "lucide-react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";

loader.config({ paths: { vs: "/monaco/vs" } });

type ProviderId = "codex-local" | "openai-api";
type ProviderHealth = "idle" | "checking" | "ready" | "offline";
type ReviewStage = "baseline" | "change";
type MobilePanel = "input" | "graph" | "inspect";
type GraphMode = "structure" | "behavior";
type GraphZoomMode = "overview" | "standard" | "detail";
type Confidence = "high" | "medium" | "low";
type JourneyPhase = "foundation" | "identity" | "exploration" | "core-workflow" | "background-work" | "delivery" | "recovery" | "operations";
type JourneyStage = "entry" | "validation" | "core" | "data" | "external" | "output" | "async" | "fallback" | "error";
type JourneyBranch = "main" | "async" | "fallback" | "error";
type SemanticKind =
  | "structure"
  | "contract"
  | "flow"
  | "routing"
  | "error"
  | "fallback"
  | "state"
  | "output"
  | "config"
  | "test"
  | "unknown";

type CodeLine = {
  id: string;
  file: string;
  lineNumber: number;
  text: string;
  side?: "old" | "new";
};

type EvidenceRange = { startLine: number; endLine: number };
type EvidenceFile = {
  path: string;
  lineNumbers: number[];
  ranges: EvidenceRange[];
  sides: Array<"source" | "old" | "new">;
};
type CodePanelMode = "relevant" | "full";

type SemanticNodeData = Record<string, unknown> & {
  stage: ReviewStage;
  title: string;
  codeIdentity?: string;
  kind: SemanticKind;
  summary: string;
  before: string;
  after: string;
  sourceCode: string;
  beforeCode: string;
  afterCode: string;
  lineIds: string[];
  confidence: Confidence;
  provides?: string[];
  uses?: string[];
  dependencyIn?: number;
  dependencyOut?: number;
  revealIndex?: number;
  inputHandles?: string[];
  outputHandles?: string[];
  relationState?: "compact" | "selected" | "internal" | "related";
  semanticId?: string;
  dependencyDirection?: "incoming" | "outgoing";
  sourcePath?: string;
  showSourcePath?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: (nodeId: string) => void;
};

type SemanticNode = Node<SemanticNodeData, "semantic">;

type StructureLevel = "system" | "subsystem" | "module" | "file";

type StructureNodeData = Record<string, unknown> & {
  structureId: string;
  level: StructureLevel;
  title: string;
  path: string;
  summary: string;
  conceptCount: number;
  fileCount: number;
  lineCount: number;
  kinds: SemanticKind[];
  behavior: string;
  dependencyIn?: number;
  dependencyOut?: number;
  revealIndex?: number;
  inputHandles?: string[];
  outputHandles?: string[];
};

type StructureNode = Node<StructureNodeData, "subsystem">;

type FileContainerNodeData = Record<string, unknown> & {
  structureId: string;
  title: string;
  path: string;
  context: "expanded" | "related" | "internal";
  behaviorCount: number;
  relationCount: number;
  internalRelationCount?: number;
  selectedBehaviorTitle?: string;
  selectedBehaviorIndex?: number;
  flowDirection?: "incoming" | "outgoing";
  dependencyIn?: number;
  dependencyOut?: number;
  inputHandles?: string[];
  outputHandles?: string[];
};

type FileContainerNode = Node<FileContainerNodeData, "fileContainer">;

type JourneyStageNodeData = Record<string, unknown> & {
  stage: JourneyStage;
  title: string;
  description: string;
  count: number;
  active: boolean;
};

type JourneyStageNode = Node<JourneyStageNodeData, "journeyStage">;

type FileGroup = {
  id: string;
  path: string;
  title: string;
  nodes: SemanticNode[];
  lineCount: number;
  kinds: SemanticKind[];
};

type ModuleGroup = {
  id: string;
  key: string;
  title: string;
  path: string;
  nodes: SemanticNode[];
  files: FileGroup[];
  lineCount: number;
  kinds: SemanticKind[];
};

type SubsystemGroup = {
  id: string;
  key: string;
  title: string;
  path: string;
  nodes: SemanticNode[];
  files: string[];
  modules: ModuleGroup[];
  lineCount: number;
  kinds: SemanticKind[];
};

type AnalysisResult = {
  stage: ReviewStage;
  nodes: SemanticNode[];
  edges: Edge[];
  inventory: CodeLine[];
  classified: number;
  unknown: number;
  source: string;
};

type AiAnalysis = {
  nodes: Array<{
    id: string;
    title: string;
    codeIdentity?: string;
    kind: SemanticKind;
    summary: string;
    before: string;
    after: string;
    lineIds: string[];
    confidence: Confidence;
    provides?: string[];
    uses?: string[];
  }>;
  edges: Array<{ source: string; target: string; label: string }>;
};

type AnalysisBatch = {
  id: string;
  files: string[];
  inventory: Array<Pick<CodeLine, "id" | "file" | "lineNumber" | "side">>;
  content: string;
};

type DirectoryEntryLike = FileHandleLike | DirectoryHandleLike;
type FileHandleLike = { kind: "file"; name: string; getFile(): Promise<File> };
type DirectoryHandleLike = { kind: "directory"; name: string; values(): AsyncIterable<DirectoryEntryLike> };
type ImportedFile = { path: string; file: File };
type AgentJobState = {
  id: string;
  status: "queued" | "analyzing" | "connecting" | "complete" | "error";
  total: number;
  completed: number;
  cached: number;
  connected: number;
  connectionGroups: number;
  error?: string | null;
};

const CODE_EXTENSIONS = new Set([
  "c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "json", "kt",
  "md", "php", "ps1", "py", "rb", "rs", "scala", "scss", "sh", "sql", "svelte", "swift", "toml",
  "ts", "tsx", "vue", "xml", "yaml", "yml",
]);
const SKIPPED_DIRECTORIES = new Set([".git", ".next", ".turbo", ".venv", "build", "coverage", "dist", "node_modules", "out", "target", "vendor"]);
const LOCAL_CODEX_BRIDGE = "http://127.0.0.1:47831";
const TARGET_BATCH_CHARACTERS = 64_000;
const TARGET_BATCH_LINES = 900;
const PARALLEL_ANALYSIS_WORKERS = 4;
const PARALLEL_INTEGRATION_WORKERS = 3;
const ANALYSIS_CACHE = "changegraph-analysis-v2";
const PROMPT_VERSION = "semantic-v7-end-to-end-architecture";
const JOURNEY_ORDERING_VERSION = "journey-reading-order-v1";

async function localBridgeIsReady() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${LOCAL_CODEX_BRIDGE}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

function isReadableRepositoryFile(path: string) {
  if (/(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock)(?:$|\.)/i.test(path)) return false;
  const name = path.split("/").pop() ?? path;
  if (["Dockerfile", "Makefile", "Procfile", "Gemfile"].includes(name)) return true;
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return CODE_EXTENSIONS.has(extension);
}

async function collectDirectoryFiles(root: DirectoryHandleLike) {
  const files: ImportedFile[] = [];
  async function walk(directory: DirectoryHandleLike, prefix = "") {
    for await (const entry of directory.values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (!SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) await walk(entry, path);
      } else {
        const file = await entry.getFile();
        if (isReadableRepositoryFile(path)) files.push({ path, file });
      }
    }
  }
  await walk(root);
  return files;
}

async function buildRepositorySnapshot(files: ImportedFile[]) {
  const sections: string[] = [];
  let included = 0;

  for (const entry of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!isReadableRepositoryFile(entry.path)) continue;
    const text = await entry.file.text();
    if (text.includes("\0")) continue;
    sections.push(`=== ${entry.path.replace(/\\/g, "/")} ===\n${text}`);
    included += 1;
  }

  return { source: sections.join("\n\n"), included };
}

function buildAnalysisBatches(inventory: CodeLine[]): AnalysisBatch[] {
  const byFile = new Map<string, CodeLine[]>();
  for (const line of inventory) byFile.set(line.file, [...(byFile.get(line.file) ?? []), line]);

  const fileSegments: CodeLine[][] = [];
  for (const lines of byFile.values()) {
    let segment: CodeLine[] = [];
    let characters = 0;
    for (const line of lines) {
      const lineSize = line.id.length + line.text.length + 8;
      if (segment.length && (segment.length >= TARGET_BATCH_LINES || characters + lineSize > TARGET_BATCH_CHARACTERS)) {
        fileSegments.push(segment);
        segment = [];
        characters = 0;
      }
      segment.push(line);
      characters += lineSize;
    }
    if (segment.length) fileSegments.push(segment);
  }

  const batches: CodeLine[][] = [];
  let current: CodeLine[] = [];
  let characters = 0;
  for (const segment of fileSegments) {
    const segmentCharacters = segment.reduce((total, line) => total + line.id.length + line.text.length + 8, 0);
    if (current.length && (current.length + segment.length > TARGET_BATCH_LINES || characters + segmentCharacters > TARGET_BATCH_CHARACTERS)) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(...segment);
    characters += segmentCharacters;
  }
  if (current.length) batches.push(current);

  return batches.map((lines, index) => ({
    id: `work-${index + 1}-${lines[0].file}-${lines[0].lineNumber}`,
    files: [...new Set(lines.map((line) => line.file))],
    inventory: lines.map(({ id, file, lineNumber, side }) => ({ id, file, lineNumber, side })),
    content: lines.map((line) => `[${line.id}] ${line.text}`).join("\n"),
  }));
}

function mergeAiAnalyses(analyses: Array<AiAnalysis | undefined>): AiAnalysis {
  const nodes: AiAnalysis["nodes"] = [];
  const edges: AiAnalysis["edges"] = [];

  analyses.forEach((analysis, batchIndex) => {
    if (!analysis) return;
    const ids = new Map<string, string>();
    for (const node of analysis.nodes ?? []) {
      const id = `batch-${batchIndex}-${node.id || nodes.length}`;
      ids.set(node.id, id);
      nodes.push({ ...node, id });
    }
    for (const edge of analysis.edges ?? []) {
      const source = ids.get(edge.source);
      const target = ids.get(edge.target);
      if (source && target) edges.push({ ...edge, source, target });
    }
  });

  return { nodes, edges };
}

async function digestText(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readCachedValue<T>(key: string): Promise<T | null> {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(ANALYSIS_CACHE);
    const response = await cache.match(`/__changegraph-cache/${key}`);
    return response ? await response.json() as T : null;
  } catch {
    return null;
  }
}

async function writeCachedValue(key: string, value: unknown) {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(ANALYSIS_CACHE);
    await cache.put(`/__changegraph-cache/${key}`, new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
  } catch {
    // Cache failures never block analysis.
  }
}

const readCachedAnalysis = (key: string) => readCachedValue<AiAnalysis>(key);
const writeCachedAnalysis = (key: string, analysis: AiAnalysis) => writeCachedValue(key, analysis);

async function runParallel<T>(items: T[], workers: number, run: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await run(items[index], index);
    }
  }));
}

function buildIntegrationWindows(nodes: AiAnalysis["nodes"]) {
  if (nodes.length < 2) return [];
  const normalizeInterface = (value: string) => value
    .toLowerCase()
    .replace(/[()`'"\s]+/g, "")
    .replace(/[^a-z0-9_./:@-]+/g, "");
  const windows: AiAnalysis["nodes"][] = [];
  const signatures = new Set<string>();
  const addWindow = (items: AiAnalysis["nodes"]) => {
    const unique = [...new Map(items.map((node) => [node.id, node])).values()];
    if (unique.length < 2) return;
    const signature = unique.map((node) => node.id).sort().join("|");
    if (signatures.has(signature)) return;
    signatures.add(signature);
    windows.push(unique);
  };

  const providers = new Map<string, AiAnalysis["nodes"]>();
  nodes.forEach((node) => (node.provides ?? []).forEach((name) => {
    const key = normalizeInterface(name);
    if (key) providers.set(key, [...(providers.get(key) ?? []), node]);
  }));
  const adjacency = new Map<string, Set<string>>();
  nodes.forEach((consumer) => (consumer.uses ?? []).forEach((name) => {
    const key = normalizeInterface(name);
    for (const provider of providers.get(key) ?? []) {
      if (provider.id === consumer.id) continue;
      adjacency.set(consumer.id, new Set([...(adjacency.get(consumer.id) ?? []), provider.id]));
      adjacency.set(provider.id, new Set([...(adjacency.get(provider.id) ?? []), consumer.id]));
    }
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const queue = [start];
    const component: AiAnalysis["nodes"] = [];
    visited.add(start);
    while (queue.length) {
      const id = queue.shift()!;
      const node = byId.get(id);
      if (node) component.push(node);
      for (const neighbor of adjacency.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    for (let index = 0; index < component.length; index += 72) addWindow(component.slice(index, index + 80));
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

function mergeEdges(primary: AiAnalysis, additions: AiAnalysis["edges"]): AiAnalysis {
  const seen = new Set(primary.edges.map((edge) => `${edge.source}|${edge.target}|${edge.label}`));
  const edges = [...primary.edges];
  for (const edge of additions) {
    const key = `${edge.source}|${edge.target}|${edge.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(edge);
    }
  }
  return { nodes: primary.nodes, edges };
}

function integrationNodeContext(nodes: AiAnalysis["nodes"], inventory: CodeLine[]) {
  const byId = new Map(inventory.map((line) => [line.id, line]));
  return nodes.map(({ id, title, codeIdentity, kind, summary, lineIds, provides, uses }) => {
    const lines = lineIds.map((lineId) => byId.get(lineId)).filter((line): line is CodeLine => Boolean(line));
    const files = [...new Set(lines.map((line) => line.file))];
    return {
      id,
      title,
      codeIdentity: codeIdentity || deriveCodeIdentity(lines),
      kind,
      summary,
      files,
      provides: provides ?? [],
      uses: uses ?? [],
      evidence: lines.slice(0, 6).map((line) => `[${line.id}] ${line.text}`).join("\n"),
    };
  });
}

const SAMPLE_SOURCE = `=== src/pricing.foo ===
class PricingService {
  constructor(primary) {
    this.primary = primary
  }

  getPrice(request) {
    try {
      return this.primary.getPrice(request)
    } catch {
      return unavailable()
    }
  }
}

=== config/pricing.env ===
PRIMARY_TIMEOUT_MS=2000
CACHE_MAX_AGE_MS=300000

=== tests/pricing.foo ===
test "primary success" {
  primary.returns(42)
  expect(service.getPrice(request)).equals(42)
}`;

const SAMPLE_DIFF = `diff --git a/src/pricing.foo b/src/pricing.foo
index 6f80a21..891ba31 100644
--- a/src/pricing.foo
+++ b/src/pricing.foo
@@ -1,13 +1,29 @@
 class PricingService {
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
+      if (!(error instanceof TimeoutError)) throw error
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
@@ -1,4 +1,14 @@
 test "primary success" {
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

const BASELINE_META: Record<SemanticKind, { title: string; summary: string; confidence: Confidence }> = {
  structure: { title: "Service boundary", summary: "Defines the service and the code blocks that contain pricing behavior.", confidence: "high" },
  contract: { title: "Provider contract", summary: "The service is constructed with one required primary pricing provider.", confidence: "high" },
  flow: { title: "Primary price path", summary: "Every request is sent directly to the primary provider.", confidence: "high" },
  routing: { title: "Failure boundary", summary: "Any provider error enters one undifferentiated catch path.", confidence: "high" },
  error: { title: "Error behavior", summary: "Provider failures are absorbed rather than propagated.", confidence: "medium" },
  fallback: { title: "Fallback path", summary: "No fallback exists in the current implementation.", confidence: "high" },
  state: { title: "State access", summary: "No stored state is read on the request path.", confidence: "medium" },
  output: { title: "Failure output", summary: "A failed primary request becomes an unavailable result.", confidence: "high" },
  config: { title: "Runtime settings", summary: "Primary timeout is two seconds; cache entries may be five minutes old.", confidence: "high" },
  test: { title: "Current evidence", summary: "The test suite proves the primary success path only.", confidence: "high" },
  unknown: { title: "Needs inspection", summary: "These source lines could not be classified with confidence.", confidence: "low" },
};

const CHANGE_META: Record<SemanticKind, { title: string; summary: string; before: string; after: string; confidence: Confidence }> = {
  structure: { title: "Structure", summary: "Code structure changed.", before: "Earlier block shape", after: "New block shape", confidence: "medium" },
  contract: { title: "Provider contract", summary: "The service now depends on backup and cache collaborators.", before: "Primary provider only", after: "Primary + backup + cache", confidence: "high" },
  flow: { title: "Request flow", summary: "The request path was rerouted.", before: "Single request path", after: "Branched request path", confidence: "medium" },
  routing: { title: "Error routing", summary: "Timeouts are separated from errors that should escape.", before: "Every error collapses", after: "Timeout branches; others escape", confidence: "high" },
  error: { title: "Error propagation", summary: "Non-timeout failures are no longer hidden.", before: "Absorb every error", after: "Throw non-timeout errors", confidence: "high" },
  fallback: { title: "Backup provider", summary: "A second provider is called after a primary timeout.", before: "No provider fallback", after: "Call backup provider", confidence: "high" },
  state: { title: "Recent cache", summary: "Cache becomes the final recovery path after backup failure.", before: "No cache lookup", after: "Read recent cached price", confidence: "high" },
  output: { title: "Output reachability", summary: "Unavailable remains possible, but only after recovery paths fail.", before: "Unavailable after first failure", after: "Unavailable after both fallbacks", confidence: "high" },
  config: { title: "Timeout policy", summary: "Primary timeout is shorter and backup gets its own budget.", before: "Primary timeout: 2000 ms", after: "Primary: 1200 ms; backup: 800 ms", confidence: "high" },
  test: { title: "Behavior evidence", summary: "New tests cover backup and cache recovery.", before: "Primary success only", after: "Backup + cache scenarios", confidence: "high" },
  unknown: { title: "Unclassified change", summary: "Meaning is not established; human inspection is required.", before: "Unknown prior meaning", after: "Unknown new meaning", confidence: "low" },
};

const BASELINE_POSITIONS: Record<SemanticKind, { x: number; y: number }> = {
  structure: { x: 0, y: 140 }, contract: { x: 290, y: 40 }, flow: { x: 290, y: 230 },
  routing: { x: 580, y: 230 }, error: { x: 870, y: 80 }, fallback: { x: 870, y: 230 },
  state: { x: 870, y: 380 }, output: { x: 870, y: 230 }, config: { x: 290, y: 420 },
  test: { x: 580, y: 420 }, unknown: { x: 0, y: 420 },
};

const CHANGE_POSITIONS: Record<SemanticKind, { x: number; y: number }> = {
  structure: { x: 0, y: 400 }, contract: { x: 0, y: 180 }, flow: { x: 280, y: 0 },
  routing: { x: 280, y: 180 }, error: { x: 560, y: 0 }, fallback: { x: 560, y: 200 },
  state: { x: 840, y: 200 }, output: { x: 840, y: 410 }, config: { x: 560, y: 410 },
  test: { x: 280, y: 410 }, unknown: { x: 0, y: 410 },
};

function parseSource(source: string): CodeLine[] {
  const inventory: CodeLine[] = [];
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
    if (!raw.trim()) continue;
    inventory.push({ id: `source:${file}:${lineNumber}`, file, lineNumber, text: raw });
  }
  return inventory;
}

function parseDiff(diff: string): CodeLine[] {
  const inventory: CodeLine[] = [];
  let file = "unknown";
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).trim();
      file = path === "/dev/null" ? file : path.replace(/^b\//, "");
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
      continue;
    }
    if (raw.startsWith("-") && !raw.startsWith("---")) {
      inventory.push({ id: `old:${file}:${oldLine}`, side: "old", file, lineNumber: oldLine, text: raw.slice(1) });
      oldLine += 1;
      continue;
    }
    if (raw.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return inventory;
}

function mergeEvidenceRanges(lineNumbers: number[]): EvidenceRange[] {
  const ordered = [...new Set(lineNumbers.filter((line) => Number.isFinite(line) && line > 0))].sort((left, right) => left - right);
  const ranges: EvidenceRange[] = [];
  ordered.forEach((line) => {
    const current = ranges[ranges.length - 1];
    if (current && line <= current.endLine + 1) current.endLine = line;
    else ranges.push({ startLine: line, endLine: line });
  });
  return ranges;
}

function evidenceFilesForNode(node?: SemanticNode): EvidenceFile[] {
  if (!node) return [];
  const grouped = new Map<string, { lines: number[]; sides: Set<"source" | "old" | "new"> }>();
  node.data.lineIds.forEach((id) => {
    const match = id.match(/^(source|old|new):(.+):(\d+)$/);
    if (!match) return;
    const path = match[2].replaceAll("\\", "/");
    const current = grouped.get(path) ?? { lines: [], sides: new Set<"source" | "old" | "new">() };
    current.lines.push(Number(match[3]));
    current.sides.add(match[1] as "source" | "old" | "new");
    grouped.set(path, current);
  });
  if (!grouped.size && node.data.sourcePath) grouped.set(node.data.sourcePath.replaceAll("\\", "/"), { lines: [], sides: new Set(["source"]) });
  return [...grouped.entries()].map(([path, evidence]) => ({
    path,
    lineNumbers: [...new Set(evidence.lines)].sort((left, right) => left - right),
    ranges: mergeEvidenceRanges(evidence.lines),
    sides: [...evidence.sides],
  })).sort((left, right) => left.path.localeCompare(right.path));
}

function repositoryFilesFromSource(source: string) {
  const files = new Map<string, string>();
  let currentPath: string | null = null;
  let currentLines: string[] = [];
  const flush = () => {
    if (currentPath) files.set(currentPath.replaceAll("\\", "/"), currentLines.join("\n"));
    currentLines = [];
  };
  source.split(/\r?\n/).forEach((line) => {
    const header = line.match(/^===\s+(.+?)\s+===$/);
    if (header) {
      flush();
      currentPath = header[1];
    } else if (currentPath) currentLines.push(line);
  });
  flush();
  if (!files.size && source) files.set("source.txt", source);
  return files;
}

function editorLanguageForFile(filePath: string) {
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  const extension = name.split(".").pop() ?? "";
  const languages: Record<string, string> = {
    c: "c", cc: "cpp", cpp: "cpp", cs: "csharp", css: "css", go: "go", h: "cpp", hpp: "cpp",
    html: "html", java: "java", js: "javascript", jsx: "javascript", json: "json", kt: "kotlin", md: "markdown",
    php: "php", ps1: "powershell", py: "python", rb: "ruby", rs: "rust", scss: "scss", sh: "shell", sql: "sql",
    svelte: "html", swift: "swift", toml: "ini", ts: "typescript", tsx: "typescript", vue: "html", xml: "xml",
    yaml: "yaml", yml: "yaml",
  };
  return languages[extension] ?? "plaintext";
}

function buildEvidenceEditorView(content: string, ranges: EvidenceRange[], mode: CodePanelMode) {
  const sourceLines = content.split(/\r?\n/);
  const lineCount = Math.max(1, sourceLines.length);
  const validRanges = ranges
    .map((range) => ({ startLine: Math.min(lineCount, range.startLine), endLine: Math.min(lineCount, range.endLine) }))
    .filter((range) => range.startLine <= range.endLine);
  if (mode === "full" || !validRanges.length) return { content, ranges: validRanges, originalLineNumbers: undefined as number[] | undefined };

  const contextSpans: EvidenceRange[] = [];
  validRanges.forEach((range) => {
    const expanded = { startLine: Math.max(1, range.startLine - 7), endLine: Math.min(lineCount, range.endLine + 9) };
    const previous = contextSpans[contextSpans.length - 1];
    if (previous && expanded.startLine <= previous.endLine + 1) previous.endLine = Math.max(previous.endLine, expanded.endLine);
    else contextSpans.push(expanded);
  });
  const visibleLines: string[] = [];
  const originalLineNumbers: number[] = [];
  const viewLineForOriginal = new Map<number, number>();
  contextSpans.forEach((span, spanIndex) => {
    if (spanIndex) {
      const previousEnd = contextSpans[spanIndex - 1].endLine;
      visibleLines.push(`// â‹¯ ${span.startLine - previousEnd - 1} lines outside this behavior â‹¯`);
      originalLineNumbers.push(0);
    }
    for (let line = span.startLine; line <= span.endLine; line += 1) {
      visibleLines.push(sourceLines[line - 1] ?? "");
      originalLineNumbers.push(line);
      viewLineForOriginal.set(line, visibleLines.length);
    }
  });
  const viewRanges = validRanges.flatMap((range) => {
    const mapped = Array.from({ length: range.endLine - range.startLine + 1 }, (_, index) => viewLineForOriginal.get(range.startLine + index)).filter((line): line is number => Boolean(line));
    return mapped.length ? [{ startLine: mapped[0], endLine: mapped[mapped.length - 1] }] : [];
  });
  return { content: visibleLines.join("\n"), ranges: viewRanges, originalLineNumbers };
}

function classifySourceLine(line: CodeLine): SemanticKind {
  const path = line.file.toLowerCase();
  const text = line.text.toLowerCase();
  if (path.includes("test") || /\b(test|expect|assert|mock)\b/.test(text)) return "test";
  if (path.includes("config") || path.endsWith(".env") || text.includes("_ms=")) return "config";
  if (text.includes("constructor") || text.includes("this.primary")) return "contract";
  if (text.includes("catch")) return "routing";
  if (text.includes("unavailable")) return "output";
  if (text.includes("getprice") || text.includes("try")) return "flow";
  if (/^[\s}]*$/.test(text) || text.includes("class ")) return "structure";
  return "structure";
}

function classifyDiffLine(line: CodeLine): SemanticKind {
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

function formatLines(lines: CodeLine[], side?: "old" | "new") {
  const selected = lines
    .filter((line) => !side || line.side === side)
    .sort((a, b) => a.file.localeCompare(b.file) || a.lineNumber - b.lineNumber);
  if (!selected.length) return side === "old" ? "// did not exist" : side === "new" ? "// removed" : "// no source lines";

  let previousFile = "";
  return selected.map((line) => {
    const header = line.file !== previousFile ? `${line.file}\n` : "";
    previousFile = line.file;
    const marker = side === "old" ? "-" : side === "new" ? "+" : " ";
    return `${header}${String(line.lineNumber).padStart(3, " ")} ${marker} ${line.text}`;
  }).join("\n");
}

function deriveCodeIdentity(lines: CodeLine[]) {
  const symbols: string[] = [];
  const files = [...new Set(lines.map((line) => line.file.replaceAll("\\", "/").split("/").pop() || line.file))];
  const ignoredCalls = new Set(["if", "for", "while", "switch", "catch", "return", "super", "this", "describe", "test", "it", "expect"]);
  const add = (value: string) => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (clean && !symbols.includes(clean)) symbols.push(clean);
  };

  for (const line of lines) {
    const text = line.text.trim();
    let match = text.match(/^#{1,6}\s+(.+)$/);
    if (match) { add(match[1]); continue; }
    match = text.match(/^<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
    if (match) { add(match[1]); continue; }
    match = text.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|enum|struct|record|trait|module|namespace)\s+([A-Za-z_$][\w$]*)/);
    if (match) { add(`${match[1]} ${match[2]}`); continue; }
    match = text.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (match) { add(`${match[1]}()`); continue; }
    match = text.match(/^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/);
    if (match) { add(`${match[1]}()`); continue; }
    match = text.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*[<(]/);
    if (match) { add(`${match[1]}()`); continue; }
    match = text.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/);
    if (match) { add(`${match[1]}()`); continue; }
    match = text.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
    if (match) { add(`${match[1]}()`); continue; }
    match = text.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE)\s+([-\w."`[\]]+)/i);
    if (match) { add(`${match[1].toLowerCase()} ${match[2]}`); continue; }
    match = text.match(/^\[([^\]]+)\]$/);
    if (match) { add(match[1]); continue; }
    match = text.match(/^(?:(?:public|private|protected|static|async|override|virtual|final|synchronized|open|internal|abstract)\s+)*(?:[A-Za-z_$][\w$<>[\]?.,:&*]*\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?:\{|=>|:)?$/);
    if (match && !ignoredCalls.has(match[1])) add(`${match[1]}()`);
  }

  const fileLabel = files.length === 1 ? files[0] : `${files[0] || "Source"} + ${Math.max(0, files.length - 1)} files`;
  if (!symbols.length) return fileLabel;
  const symbolLabel = symbols.slice(0, 2).join(" · ");
  const remainder = symbols.length > 2 ? ` + ${symbols.length - 2}` : "";
  return files.length === 1 ? `${fileLabel} · ${symbolLabel}${remainder}` : `${symbolLabel}${remainder}`;
}

function makeEdge(source: string, target: string, label: string, color = "#23AFD0"): Edge {
  return {
    id: `${source}-${target}-${label}`,
    source,
    target,
    label,
    type: "graph",
    markerEnd: { type: MarkerType.ArrowClosed, color },
    style: { stroke: color, strokeWidth: 1.5 },
    labelStyle: { fill: "#CCCCCC", fontSize: 10, fontWeight: 700 },
    labelBgStyle: { fill: "#252526", fillOpacity: 0.96 },
  };
}

const GENERIC_PATH_SEGMENTS = new Set(["app", "apps", "lib", "libs", "module", "modules", "package", "packages", "service", "services", "src"]);

function fileFromLineId(lineId: string) {
  return lineId.match(/^(?:source|old|new):(.+):\d+$/)?.[1]?.replaceAll("\\", "/") ?? "unknown";
}

function humanizePathSegment(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function subsystemFromFile(file: string) {
  const segments = file.split("/").filter(Boolean);
  if (segments.length <= 1) return { key: "root", title: "Root & configuration", path: "Repository root" };
  const index = GENERIC_PATH_SEGMENTS.has(segments[0].toLowerCase()) && segments.length > 2 ? 1 : 0;
  const keySegments = index === 1 ? segments.slice(0, 2) : segments.slice(0, 1);
  return {
    key: keySegments.join("/"),
    title: humanizePathSegment(segments[index] || segments[0]),
    path: `${keySegments.join("/")}/`,
  };
}

function buildSubsystemGroups(nodes: SemanticNode[]) {
  const grouped = new Map<string, Omit<SubsystemGroup, "id">>();
  for (const node of nodes) {
    const ownership = new Map<string, { count: number; title: string; path: string }>();
    for (const lineId of node.data.lineIds) {
      const subsystem = subsystemFromFile(fileFromLineId(lineId));
      const current = ownership.get(subsystem.key);
      ownership.set(subsystem.key, { count: (current?.count ?? 0) + 1, title: subsystem.title, path: subsystem.path });
    }
    const primary = [...ownership.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))[0]
      ?? ["unknown", { count: 0, title: "Needs inspection", path: "Unknown ownership" }] as const;
    const [key, metadata] = primary;
    const current = grouped.get(key) ?? { key, title: metadata.title, path: metadata.path, nodes: [], files: [], modules: [], lineCount: 0, kinds: [] };
    current.nodes.push(node);
    current.lineCount += node.data.lineIds.length;
    current.files = [...new Set([...current.files, ...node.data.lineIds.map(fileFromLineId)])];
    current.kinds = [...new Set([...current.kinds, node.data.kind])];
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort((a, b) => b.nodes.length - a.nodes.length || a.title.localeCompare(b.title))
    .map((group) => {
      const id = `subsystem-${group.key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
      return { ...group, id, modules: buildModuleGroups(group.key, group.nodes) };
    });
}

function primaryFileForNode(node: SemanticNode) {
  const counts = new Map<string, number>();
  for (const lineId of node.data.lineIds) {
    const file = fileFromLineId(lineId);
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "unknown";
}

function buildFileGroups(nodes: SemanticNode[]) {
  const grouped = new Map<string, FileGroup>();
  for (const node of nodes) {
    const path = primaryFileForNode(node);
    const current = grouped.get(path) ?? {
      id: `file-${path.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      path,
      title: path.split("/").pop() || path,
      nodes: [],
      lineCount: 0,
      kinds: [],
    };
    current.nodes.push(node);
    current.lineCount += node.data.lineIds.length;
    current.kinds = [...new Set([...current.kinds, node.data.kind])];
    grouped.set(path, current);
  }
  return [...grouped.values()].sort((a, b) => b.nodes.length - a.nodes.length || a.path.localeCompare(b.path));
}

function buildModuleGroups(subsystemKey: string, nodes: SemanticNode[]) {
  const grouped = new Map<string, Omit<ModuleGroup, "id" | "files">>();
  const subsystemDepth = subsystemKey === "root" ? 0 : subsystemKey.split("/").length;
  for (const node of nodes) {
    const file = primaryFileForNode(node);
    const segments = file.split("/").filter(Boolean);
    let moduleIndex = subsystemDepth;
    while (moduleIndex < segments.length - 1 && GENERIC_PATH_SEGMENTS.has(segments[moduleIndex].toLowerCase())) moduleIndex += 1;
    const hasFolder = moduleIndex < segments.length - 1;
    const key = hasFolder ? segments.slice(0, moduleIndex + 1).join("/") : `${subsystemKey}/__root__`;
    const title = hasFolder ? humanizePathSegment(segments[moduleIndex]) : "Root files";
    const path = hasFolder ? `${segments.slice(0, moduleIndex + 1).join("/")}/` : subsystemKey === "root" ? "Repository root" : `${subsystemKey}/`;
    const current = grouped.get(key) ?? { key, title, path, nodes: [], lineCount: 0, kinds: [] };
    current.nodes.push(node);
    current.lineCount += node.data.lineIds.length;
    current.kinds = [...new Set([...current.kinds, node.data.kind])];
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort((a, b) => b.nodes.length - a.nodes.length || a.title.localeCompare(b.title))
    .map((group) => ({
      ...group,
      id: `module-${group.key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      files: buildFileGroups(group.nodes),
    }));
}

type GraphLayout = {
  nodes: Array<StructureNode | SemanticNode | FileContainerNode | JourneyStageNode>;
  edges: Edge[];
};

type BehaviorOwnership = {
  subsystemId: string;
  moduleId: string;
  fileId: string;
  filePath: string;
};

type DependencyMember = {
  source: string;
  target: string;
  label: string;
};

type DependencyEdgeData = Record<string, unknown> & {
  dependency?: boolean;
  dependencyScope?: "same-file" | "cross-file";
  count?: number;
  primaryLabel?: string;
  members?: DependencyMember[];
};

type SystemJourney = {
  id: string;
  anchorId: string;
  title: string;
  description: string;
  nodeIds: string[];
  contracts: string[];
};

type JourneyOrderItem = {
  journeyId: string;
  phase: JourneyPhase;
  sequence: number;
  rationale: string;
};

type JourneyOrderPlan = {
  journeys: JourneyOrderItem[];
};

type JourneyStageStep = {
  nodeId: string;
  stage: JourneyStage;
  branch: JourneyBranch;
  sequence: number;
};

type JourneyStagePlan = {
  journeyId: string;
  summary: string;
  steps: JourneyStageStep[];
};

const JOURNEY_PHASE_ORDER: JourneyPhase[] = ["foundation", "identity", "exploration", "core-workflow", "background-work", "delivery", "recovery", "operations"];
const JOURNEY_STAGE_ORDER: JourneyStage[] = ["entry", "validation", "core", "data", "external", "output", "async", "fallback", "error"];
const JOURNEY_STAGE_COPY: Record<JourneyStage, { title: string; description: string }> = {
  entry: { title: "Entry", description: "Where this behavior starts" },
  validation: { title: "Validation", description: "Checks that allow or reject the request" },
  core: { title: "Core processing", description: "The main decisions and transformations" },
  data: { title: "Data and storage", description: "Reads, writes, and persisted state" },
  external: { title: "External systems", description: "Services and boundaries outside this module" },
  output: { title: "Result", description: "What the journey returns or exposes" },
  async: { title: "Async work", description: "Work that continues outside the direct response" },
  fallback: { title: "Fallback and retry", description: "Alternative behavior when the main path cannot continue" },
  error: { title: "Errors", description: "Failures that stop or reject the journey" },
};

function defaultJourneyPhase(journey: SystemJourney): JourneyPhase {
  const text = `${journey.title} ${journey.description} ${journey.contracts.join(" ")}`.toLowerCase();
  if (/health|startup|config|bootstrap|migration/.test(text)) return "foundation";
  if (/auth|login|session|token|permission|user/.test(text)) return "identity";
  if (/get|read|list|search|catalog|browse|status/.test(text)) return "exploration";
  if (/queue|event|worker|background|websocket|stream/.test(text)) return "background-work";
  if (/result|download|notify|response|delivery|export/.test(text)) return "delivery";
  if (/cancel|retry|fallback|error|fail|delete/.test(text)) return "recovery";
  if (/admin|metric|audit|monitor|operation/.test(text)) return "operations";
  return "core-workflow";
}

function defaultJourneyStage(node: SemanticNode): JourneyStage {
  const text = `${node.data.title} ${node.data.codeIdentity || ""} ${node.data.summary} ${(node.data.provides ?? []).join(" ")} ${(node.data.uses ?? []).join(" ")}`.toLowerCase();
  if (node.data.kind === "error" || /\b(error|exception|reject|invalid|unauthorized|forbidden)\b/.test(text)) return "error";
  if (node.data.kind === "fallback" || /\b(fallback|retry|degrade|default)\b/.test(text)) return "fallback";
  if (/\b(queue|event|worker|background|async|websocket|publish|consume)\b/.test(text)) return "async";
  if (/\b(database| db |sql|repository|persist|store|cache|transaction|model)\b/.test(` ${text} `) || node.data.kind === "state") return "data";
  if (/\b(http|external|provider|client|third.party|object store|s3|r2)\b/.test(text)) return "external";
  if (node.data.kind === "output" || /\b(return|response|result|render|emit|display|download)\b/.test(text)) return "output";
  if (/\b(validate|verify|authorize|authenticate|permission|guard|check)\b/.test(text)) return "validation";
  if (node.data.kind === "routing" || node.data.kind === "contract" || /\b(route|endpoint|trigger|request|command|entry)\b/.test(text)) return "entry";
  return "core";
}

function defaultJourneyBranch(stage: JourneyStage): JourneyBranch {
  return stage === "async" || stage === "fallback" || stage === "error" ? stage : "main";
}

function fallbackJourneyStagePlan(journey: SystemJourney, analysis: AnalysisResult): JourneyStagePlan {
  const ids = new Set(journey.nodeIds);
  const nodes = analysis.nodes.filter((node) => ids.has(node.id));
  const rankOrder = new Map(rankBehaviorGraph(nodes, analysis.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)), 12).flat().map((node, index) => [node.id, index]));
  return {
    journeyId: journey.id,
    summary: "Stages inferred from the mapped behavior and its existing connections.",
    steps: nodes.map((node, index) => {
      const stage = defaultJourneyStage(node);
      return { nodeId: node.id, stage, branch: defaultJourneyBranch(stage), sequence: rankOrder.get(node.id) ?? index };
    }).sort((left, right) => left.sequence - right.sequence),
  };
}

function validateJourneyOrderPlan(value: unknown, journeys: SystemJourney[]): JourneyOrderPlan {
  const raw = value && typeof value === "object" && Array.isArray((value as { journeys?: unknown[] }).journeys)
    ? (value as { journeys: unknown[] }).journeys
    : [];
  const byId = new Map(journeys.map((journey) => [journey.id, journey]));
  const seen = new Set<string>();
  const valid = raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<JourneyOrderItem>;
    if (!candidate.journeyId || !byId.has(candidate.journeyId) || seen.has(candidate.journeyId)) return [];
    seen.add(candidate.journeyId);
    const journey = byId.get(candidate.journeyId)!;
    const phase = JOURNEY_PHASE_ORDER.includes(candidate.phase as JourneyPhase) ? candidate.phase as JourneyPhase : defaultJourneyPhase(journey);
    return [{ journeyId: candidate.journeyId, phase, sequence: Number.isFinite(candidate.sequence) ? Number(candidate.sequence) : index, rationale: String(candidate.rationale || "Placed from its trigger and system outcome.") }];
  });
  journeys.forEach((journey, index) => {
    if (!seen.has(journey.id)) valid.push({ journeyId: journey.id, phase: defaultJourneyPhase(journey), sequence: raw.length + index, rationale: "Placed deterministically because the AI ordering omitted this journey." });
  });
  return { journeys: valid };
}

function validateJourneyStagePlan(value: unknown, journey: SystemJourney, analysis: AnalysisResult): JourneyStagePlan {
  const fallback = fallbackJourneyStagePlan(journey, analysis);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as { journeyId?: unknown; summary?: unknown; steps?: unknown[] };
  if (candidate.journeyId !== journey.id || !Array.isArray(candidate.steps)) return fallback;
  const allowed = new Set(journey.nodeIds);
  const seen = new Set<string>();
  const steps = candidate.steps.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const step = item as Partial<JourneyStageStep>;
    if (!step.nodeId || !allowed.has(step.nodeId) || seen.has(step.nodeId)) return [];
    seen.add(step.nodeId);
    const node = analysis.nodes.find((current) => current.id === step.nodeId);
    const stage = JOURNEY_STAGE_ORDER.includes(step.stage as JourneyStage) ? step.stage as JourneyStage : node ? defaultJourneyStage(node) : "core";
    const branch = (["main", "async", "fallback", "error"] as JourneyBranch[]).includes(step.branch as JourneyBranch) ? step.branch as JourneyBranch : defaultJourneyBranch(stage);
    return [{ nodeId: step.nodeId, stage, branch, sequence: Number.isFinite(step.sequence) ? Number(step.sequence) : index }];
  });
  fallback.steps.forEach((step) => { if (!seen.has(step.nodeId)) steps.push({ ...step, sequence: steps.length + step.sequence }); });
  return { journeyId: journey.id, summary: String(candidate.summary || fallback.summary), steps: steps.sort((left, right) => left.sequence - right.sequence) };
}

function rankBehaviorGraph(nodes: SemanticNode[], edges: Edge[], maxRank = 4) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  });
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const predecessors = incoming.get(id) ?? [];
    const rank = predecessors.length ? Math.min(maxRank, Math.max(...predecessors.map((source) => rankOf(source) + 1))) : 0;
    visiting.delete(id);
    memo.set(id, rank);
    return rank;
  };
  const ranks: SemanticNode[][] = [];
  nodes.forEach((node) => {
    const rank = rankOf(node.id);
    (ranks[rank] ??= []).push(node);
  });
  const order = new Map<string, number>();
  ranks.forEach((rankNodes, rank) => {
    rankNodes.sort((a, b) => {
      const barycenter = (node: SemanticNode) => {
        const predecessors = (incoming.get(node.id) ?? []).filter((id) => (memo.get(id) ?? 0) < rank);
        return predecessors.length ? predecessors.reduce((total, id) => total + (order.get(id) ?? 0), 0) / predecessors.length : Number.MAX_SAFE_INTEGER;
      };
      return barycenter(a) - barycenter(b) || a.data.title.localeCompare(b.data.title);
    });
    rankNodes.forEach((node, index) => order.set(node.id, index));
  });
  return ranks;
}

function normalizeJourneyContract(value: string) {
  return value
    .trim()
    .replace(/\[(\w+)\]|:(\w+)|\{[^}]+\}/g, "{param}")
    .replace(/\s+/g, " ");
}

function journeyFamily(contract: string) {
  return normalizeJourneyContract(contract).toLowerCase();
}

function journeyTitle(family: string, fallback: string) {
  const http = family.match(/^http\s+(get|post|put|patch|delete|options|head)\s+(.+)$/i);
  if (!http) return fallback;
  const segments = http[2].split(/[/?#]/).filter((segment) => segment && !/^\{.+\}$/.test(segment) && !/^v\d+$/i.test(segment) && segment !== "api");
  const subject = segments.slice(-2).map(humanizePathSegment).join(" ");
  const action: Record<string, string> = { get: "Read", post: "Create", put: "Replace", patch: "Update", delete: "Delete", options: "Inspect", head: "Inspect" };
  return subject ? `${action[http[1].toLowerCase()] ?? humanizePathSegment(http[1])} ${subject}` : fallback;
}

const JOURNEY_IDENTITY_STOP_WORDS = new Set([
  "api", "behavior", "controller", "endpoint", "flow", "function", "handler", "method", "route", "service", "the", "with",
]);

function behaviorIdentity(node: SemanticNode) {
  const normalized = `${node.data.title} ${node.data.codeIdentity || ""}`
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\.[a-z0-9]+\b/g, " ")
    .match(/[a-z0-9_]{3,}/g) ?? [];
  const terms = normalized.filter((term) => !JOURNEY_IDENTITY_STOP_WORDS.has(term));
  return terms.slice(0, 8).join(" ") || node.data.title.toLowerCase();
}

function buildSystemJourneys(analysis: AnalysisResult, ownership: Map<string, BehaviorOwnership>) {
  const nodeById = new Map(analysis.nodes.map((node) => [node.id, node]));
  const validEdges = analysis.edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target) && edge.source !== edge.target);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const crossModuleDegree = new Map<string, number>();
  validEdges.forEach((edge) => {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    if (ownership.get(edge.source)?.moduleId !== ownership.get(edge.target)?.moduleId) {
      crossModuleDegree.set(edge.source, (crossModuleDegree.get(edge.source) ?? 0) + 1);
      crossModuleDegree.set(edge.target, (crossModuleDegree.get(edge.target) ?? 0) + 1);
    }
  });
  const nodeScore = (node: SemanticNode) => {
    const inCount = incoming.get(node.id)?.length ?? 0;
    const outCount = outgoing.get(node.id)?.length ?? 0;
    const crossModule = crossModuleDegree.get(node.id) ?? 0;
    const kindBonus = ["routing", "contract", "flow"].includes(node.data.kind) ? 12 : ["test", "config", "unknown"].includes(node.data.kind) ? -8 : 0;
    return Math.min(inCount, outCount) * 10 + (inCount + outCount) * 3 + crossModule * 14 + kindBonus;
  };
  const termsByNode = new Map<string, Set<string>>();
  const termsForNode = (node: SemanticNode) => {
    const existing = termsByNode.get(node.id);
    if (existing) return existing;
    const terms = new Set((`${node.data.title} ${node.data.codeIdentity || ""} ${node.data.summary} ${(node.data.provides ?? []).join(" ")} ${(node.data.uses ?? []).join(" ")}`
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z0-9_]{3,}/g) ?? []).filter((term) => !JOURNEY_IDENTITY_STOP_WORDS.has(term)));
    termsByNode.set(node.id, terms);
    return terms;
  };
  const behaviorTerms = (nodes: SemanticNode[]) => new Set(nodes.flatMap((node) => [...termsForNode(node)]));
  const overlapWithJourney = (node: SemanticNode, journeyTerms: Set<string>) => {
    let overlap = 0;
    for (const term of termsForNode(node)) if (journeyTerms.has(term)) overlap += 1;
    return overlap;
  };
  const rankedNeighbors = (ids: string[], currentId: string, journeyTerms: Set<string>) => [...new Set(ids)]
    .map((id) => nodeById.get(id))
    .filter((node): node is SemanticNode => Boolean(node))
    .sort((left, right) => {
      const currentOwner = ownership.get(currentId);
      const leftOwner = ownership.get(left.id);
      const rightOwner = ownership.get(right.id);
      const leftCross = currentOwner && leftOwner && currentOwner.moduleId !== leftOwner.moduleId ? 1 : 0;
      const rightCross = currentOwner && rightOwner && currentOwner.moduleId !== rightOwner.moduleId ? 1 : 0;
      return overlapWithJourney(right, journeyTerms) - overlapWithJourney(left, journeyTerms)
        || rightCross - leftCross
        || nodeScore(right) - nodeScore(left);
    });
  const collectJourneyNodes = (seedIds: string[]) => {
    const seeds = seedIds.filter((id) => nodeById.has(id)).slice(0, 10);
    const selected = new Set(seeds);
    const seedNodes = seeds.map((id) => nodeById.get(id)).filter((node): node is SemanticNode => Boolean(node));
    const journeyTerms = behaviorTerms(seedNodes);
    const walk = (direction: "incoming" | "outgoing", depth: number) => {
      let frontier = [...seeds];
      for (let level = 0; level < depth && frontier.length && selected.size < 20; level += 1) {
        const next: string[] = [];
        for (const current of frontier) {
          const neighborIds = direction === "incoming" ? incoming.get(current) ?? [] : outgoing.get(current) ?? [];
          const candidates = rankedNeighbors(neighborIds, current, journeyTerms).slice(0, level === 0 ? 4 : 2);
          for (const node of candidates) {
            if (selected.size >= 20) break;
            if (["test", "structure"].includes(node.data.kind) && level > 0) continue;
            const overlap = overlapWithJourney(node, journeyTerms);
            if (level > 0 && overlap === 0 && !["error", "fallback", "state", "output"].includes(node.data.kind)) continue;
            if (!selected.has(node.id)) {
              selected.add(node.id);
              next.push(node.id);
            }
          }
        }
        frontier = next;
      }
    };
    walk("incoming", 2);
    walk("outgoing", 3);
    return [...selected];
  };

  const contractGroups = new Map<string, { contracts: Set<string>; nodeIds: Set<string> }>();
  analysis.nodes.forEach((node) => {
    const interfaces = [...(node.data.provides ?? []), ...(node.data.uses ?? [])]
      .map(normalizeJourneyContract)
      .filter((value) => /^HTTP\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\//i.test(value) || /^(QUEUE CONSUME|EVENT RECEIVE|COMMAND)\s+/i.test(value));
    interfaces.forEach((contract) => {
      const family = journeyFamily(contract);
      const group = contractGroups.get(family) ?? { contracts: new Set<string>(), nodeIds: new Set<string>() };
      group.contracts.add(contract);
      group.nodeIds.add(node.id);
      contractGroups.set(family, group);
    });
  });

  const journeys: SystemJourney[] = [...contractGroups.entries()].map(([family, group], index) => {
    const seeds = [...group.nodeIds];
    const anchor = seeds.map((id) => nodeById.get(id)).filter((node): node is SemanticNode => Boolean(node))
      .sort((left, right) => nodeScore(right) - nodeScore(left))[0];
    const contracts = [...group.contracts].sort();
    return {
      id: `journey-contract-${index}-${family.replace(/[^a-z0-9]+/g, "-")}`,
      anchorId: anchor?.id ?? seeds[0],
      title: journeyTitle(family, anchor?.data.title ?? "System journey"),
      description: contracts.length === 1 ? contracts[0] : `${contracts.length} aliases for the same behavior`,
      nodeIds: collectJourneyNodes(seeds),
      contracts,
    };
  });

  if (!journeys.length) {
    const candidates = analysis.nodes
      .filter((node) => (incoming.get(node.id)?.length ?? 0) > 0 && (outgoing.get(node.id)?.length ?? 0) > 0)
      .sort((left, right) => nodeScore(right) - nodeScore(left));
    const grouped = new Map<string, SemanticNode[]>();
    candidates.forEach((node) => {
      const key = behaviorIdentity(node);
      grouped.set(key, [...(grouped.get(key) ?? []), node]);
    });
    [...grouped.values()].slice(0, 48).forEach((group, index) => {
      const anchor = group.sort((left, right) => nodeScore(right) - nodeScore(left))[0];
      journeys.push({
        id: `journey-flow-${index}-${anchor.id}`,
        anchorId: anchor.id,
        title: anchor.data.title,
        description: group.length === 1 ? "One distinct behavior flow" : `${group.length} implementations of the same behavior`,
        nodeIds: collectJourneyNodes(group.map((node) => node.id)),
        contracts: [],
      });
    });
  }

  return journeys
    .filter((journey) => journey.anchorId && journey.nodeIds.length > 1)
    .sort((left, right) => right.nodeIds.length - left.nodeIds.length || left.title.localeCompare(right.title))
    .slice(0, 48);
}

function orderedJourneysFromPlan(journeys: SystemJourney[], plan: JourneyOrderPlan | null) {
  const order = new Map((plan?.journeys ?? []).map((item) => [item.journeyId, item]));
  return [...journeys].sort((left, right) => {
    const leftOrder = order.get(left.id);
    const rightOrder = order.get(right.id);
    const leftPhase = leftOrder?.phase ?? defaultJourneyPhase(left);
    const rightPhase = rightOrder?.phase ?? defaultJourneyPhase(right);
    return JOURNEY_PHASE_ORDER.indexOf(leftPhase) - JOURNEY_PHASE_ORDER.indexOf(rightPhase)
      || (leftOrder?.sequence ?? Number.MAX_SAFE_INTEGER) - (rightOrder?.sequence ?? Number.MAX_SAFE_INTEGER)
      || left.title.localeCompare(right.title);
  });
}

function journeyPhaseLabel(phase: JourneyPhase) {
  const labels: Record<JourneyPhase, string> = {
    foundation: "Foundation and startup",
    identity: "Identity and access",
    exploration: "Read and exploration",
    "core-workflow": "Core workflows",
    "background-work": "Background processing",
    delivery: "Results and delivery",
    recovery: "Recovery and failure handling",
    operations: "Operations and administration",
  };
  return labels[phase];
}

function journeyOrderingContext(journeys: SystemJourney[], analysis: AnalysisResult, ownership: Map<string, BehaviorOwnership>) {
  const nodeById = new Map(analysis.nodes.map((node) => [node.id, node]));
  return journeys.map((journey) => {
    const nodes = journey.nodeIds.map((id) => nodeById.get(id)).filter((node): node is SemanticNode => Boolean(node));
    return {
      journeyId: journey.id,
      currentTitle: journey.title,
      contract: journey.description,
      contracts: journey.contracts,
      entryBehavior: nodeById.get(journey.anchorId)?.data.title ?? journey.title,
      notableBehaviors: nodes.slice(0, 6).map((node) => ({ title: node.data.title, kind: node.data.kind, codeIdentity: node.data.codeIdentity || "" })),
      sourceAreas: [...new Set(nodes.map((node) => ownership.get(node.id)?.filePath).filter(Boolean))].slice(0, 5),
    };
  });
}

function journeyStageContext(journey: SystemJourney, analysis: AnalysisResult, ownership: Map<string, BehaviorOwnership>) {
  const ids = new Set(journey.nodeIds);
  return {
    journey: { journeyId: journey.id, title: journey.title, description: journey.description, contracts: journey.contracts },
    nodes: analysis.nodes.filter((node) => ids.has(node.id)).map((node) => ({
      nodeId: node.id,
      title: node.data.title,
      codeIdentity: node.data.codeIdentity || "",
      kind: node.data.kind,
      summary: node.data.summary,
      sourcePath: ownership.get(node.id)?.filePath ?? primaryFileForNode(node),
      provides: node.data.provides ?? [],
      uses: node.data.uses ?? [],
    })),
    edges: analysis.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ source: edge.source, target: edge.target, label: String(edge.label || "") })),
  };
}

function describeBehaviorKinds(nodes: SemanticNode[]) {
  const counts = new Map<SemanticKind, number>();
  nodes.forEach((node) => counts.set(node.data.kind, (counts.get(node.data.kind) ?? 0) + 1));
  const labels = [...counts.entries()]
    .filter(([kind]) => kind !== "structure")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kind]) => humanizePathSegment(kind));
  return labels.length ? `${labels.join(" · ")} behavior` : "Code structure and ownership";
}

function centeredY(index: number, count: number, center: number, gap = 420) {
  return center + (index - (count - 1) / 2) * gap;
}

const BEHAVIOR_CARD_WIDTH = 540;
const FILE_GROUP_PADDING = 68;
const FILE_GROUP_HEADER = 234;
const BEHAVIOR_COLUMN_GAP = 72;
const BEHAVIOR_ROW_GAP = 84;

function estimatedBehaviorHeight(node: SemanticNode, expanded: boolean) {
  if (!expanded) return 220;
  const identityLength = `${node.data.codeIdentity || ""} ${node.data.title}`.length;
  const headerLines = Math.max(2, Math.ceil(identityLength / 44));
  const headerHeight = 142 + Math.max(0, headerLines - 2) * 34;
  const bodyLines = node.data.stage === "baseline"
    ? Math.max(2, Math.ceil(node.data.summary.length / 40))
    : Math.max(2, Math.ceil(node.data.before.length / 28), Math.ceil(node.data.after.length / 28));
  const bodyHeight = Math.max(node.data.stage === "baseline" ? 122 : 144, 66 + bodyLines * 35);
  return Math.min(1400, headerHeight + bodyHeight + 86);
}

function arrangeHldRanks(ranks: SemanticNode[][], edges: Edge[], expanded: boolean) {
  const nodes = ranks.flat();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  });
  const positions = new Map<string, { x: number; y: number }>();
  const columnGap = expanded ? 920 : 820;
  const rowGap = expanded ? 190 : 150;
  const heightOf = (node: SemanticNode) => estimatedBehaviorHeight(node, expanded) + 76;
  const centerOf = (id: string) => {
    const node = nodeById.get(id);
    const position = positions.get(id);
    return node && position ? position.y + heightOf(node) / 2 : null;
  };
  const median = (values: number[]) => {
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  };
  const placeRank = (rank: SemanticNode[], rankIndex: number, direction: "incoming" | "outgoing") => {
    const desired = rank.map((node, index) => {
      const related = (direction === "incoming" ? incoming.get(node.id) : outgoing.get(node.id)) ?? [];
      const centers = related.map(centerOf).filter((value): value is number => value !== null);
      const current = centerOf(node.id);
      return { node, center: centers.length ? median(centers) : current ?? index * (heightOf(node) + rowGap) };
    }).sort((left, right) => left.center - right.center || left.node.data.title.localeCompare(right.node.data.title));
    let cursor = 0;
    desired.forEach(({ node, center }) => {
      const y = Math.max(cursor, center - heightOf(node) / 2);
      positions.set(node.id, { x: rankIndex * columnGap, y });
      cursor = y + heightOf(node) + rowGap;
    });
  };

  ranks.forEach((rank, rankIndex) => placeRank(rank, rankIndex, "incoming"));
  for (let pass = 0; pass < 3; pass += 1) {
    for (let rankIndex = 1; rankIndex < ranks.length; rankIndex += 1) placeRank(ranks[rankIndex], rankIndex, "incoming");
    for (let rankIndex = ranks.length - 2; rankIndex >= 0; rankIndex -= 1) placeRank(ranks[rankIndex], rankIndex, "outgoing");
  }
  const minY = Math.min(0, ...positions.values().map((position) => position.y));
  const shift = 160 - minY;
  positions.forEach((position, id) => positions.set(id, { x: position.x, y: position.y + shift }));
  return positions;
}

function fileContainerLayout(behaviors: SemanticNode[], columns: number, expandedId?: string, expandAll = false) {
  const actualColumns = Math.max(1, Math.min(columns, behaviors.length || 1));
  const rows = Math.max(1, Math.ceil(behaviors.length / actualColumns));
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(
    250,
    ...behaviors.slice(row * actualColumns, (row + 1) * actualColumns).map((node) => estimatedBehaviorHeight(node, expandAll || node.id === expandedId)),
  ));
  const rowOffsets: number[] = [];
  let cursor = FILE_GROUP_HEADER;
  rowHeights.forEach((height) => {
    rowOffsets.push(cursor);
    cursor += height + BEHAVIOR_ROW_GAP;
  });
  return {
    columns: actualColumns,
    width: FILE_GROUP_PADDING * 2 + actualColumns * BEHAVIOR_CARD_WIDTH + (actualColumns - 1) * BEHAVIOR_COLUMN_GAP,
    height: cursor - BEHAVIOR_ROW_GAP + FILE_GROUP_PADDING,
    positions: behaviors.map((_, index) => ({
      x: FILE_GROUP_PADDING + (index % actualColumns) * (BEHAVIOR_CARD_WIDTH + BEHAVIOR_COLUMN_GAP),
      y: rowOffsets[Math.floor(index / actualColumns)],
    })),
  };
}

function graphZoomMode(zoom: number): GraphZoomMode {
  if (zoom < .26) return "overview";
  if (zoom < .68) return "standard";
  return "detail";
}

function structureEdge(source: string, target: string, color: string): Edge {
  return { ...makeEdge(source, target, "", color), id: `${source}-${target}` };
}

function buildBehaviorOwnership(subsystemGroups: SubsystemGroup[]) {
  const ownership = new Map<string, BehaviorOwnership>();
  subsystemGroups.forEach((subsystem) => subsystem.modules.forEach((module) => module.files.forEach((file) => {
    file.nodes.forEach((node) => ownership.set(node.id, {
      subsystemId: subsystem.id,
      moduleId: module.id,
      fileId: file.id,
      filePath: file.path,
    }));
  })));
  return ownership;
}

function plainDependencyLabel(label: string, target?: SemanticNode) {
  const clean = label.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const targetName = (target?.data.title || target?.data.codeIdentity || "the target behavior").replace(/[.]+$/, "").toLowerCase();
  const generic: Record<string, string> = {
    "depends on": `gets ${targetName}`,
    "relates to": `gets ${targetName}`,
    "uses": `uses ${targetName}`,
    "calls": `calls ${targetName}`,
    "reads": `reads ${targetName}`,
    "supplies": `gets ${targetName}`,
    "provides": `gets ${targetName}`,
    "configures": `reads settings from ${targetName}`,
    "proved by": `is verified by ${targetName}`,
    "tested by": `is verified by ${targetName}`,
  };
  const phrase = generic[clean] || clean || `gets ${targetName}`;
  const words = phrase.split(" ");
  return words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : phrase;
}

function aggregateVisibleDependencyEdges(
  analysis: AnalysisResult,
  visibleNodes: Array<StructureNode | SemanticNode | FileContainerNode>,
  focusedNodeId: string | null,
) {
  const semanticById = new Map(analysis.nodes.map((node) => [node.id, node]));
  if (!focusedNodeId || !semanticById.has(focusedNodeId)) return [];
  const visibleById = new Map(visibleNodes.map((node) => [node.id, node]));
  const aliasByBehavior = new Map<string, string>();
  visibleNodes.forEach((node) => {
    if (node.type !== "semantic" || !node.data.semanticId || !node.data.dependencyDirection) return;
    aliasByBehavior.set(`${node.data.dependencyDirection}|${node.data.semanticId}`, node.id);
  });
  const visualEndpoint = (behaviorId: string, direction: "incoming" | "outgoing") => (
    behaviorId === focusedNodeId ? behaviorId : aliasByBehavior.get(`${direction}|${behaviorId}`)
  );
  const bundleEndpoint = (visualId: string) => {
    const node = visibleById.get(visualId);
    if (!node?.parentId) return visualId;
    const parent = visibleById.get(node.parentId);
    return parent?.type === "fileContainer" && parent.data.context !== "expanded" ? parent.id : visualId;
  };
  const endpointScope = (id: string) => {
    const node = visibleById.get(id);
    const container = node?.type === "fileContainer" ? node : node?.parentId ? visibleById.get(node.parentId) : undefined;
    return container?.type === "fileContainer" && container.data.context === "internal" ? "same-file" : "cross-file";
  };
  const groups = new Map<string, { source: string; target: string; scope: "same-file" | "cross-file"; members: DependencyMember[]; labels: Map<string, number> }>();
  analysis.edges.forEach((edge) => {
    if (edge.source !== focusedNodeId && edge.target !== focusedNodeId) return;
    if (edge.source === edge.target) return;
    const direction = edge.target === focusedNodeId ? "incoming" : "outgoing";
    const sourceVisual = visualEndpoint(edge.source, direction);
    const targetVisual = visualEndpoint(edge.target, direction);
    if (!sourceVisual || !targetVisual) return;
    const source = bundleEndpoint(sourceVisual);
    const target = bundleEndpoint(targetVisual);
    const scope = endpointScope(source) === "same-file" || endpointScope(target) === "same-file" ? "same-file" : "cross-file";
    const key = `${scope}|${source}|${target}`;
    const current = groups.get(key) ?? { source, target, scope, members: [], labels: new Map<string, number>() };
    const label = String(edge.label || "DEPENDS ON").trim() || "DEPENDS ON";
    current.members.push({ source: edge.source, target: edge.target, label });
    current.labels.set(label, (current.labels.get(label) ?? 0) + 1);
    groups.set(key, current);
  });

  return [...groups.values()]
    .sort((a, b) => b.members.length - a.members.length || a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
    .map((group) => {
    const primaryLabel = [...group.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "DEPENDS ON";
    const representativeMember = group.members.find((member) => member.label === primaryLabel) ?? group.members[0];
    const naturalLabel = plainDependencyLabel(primaryLabel, semanticById.get(representativeMember?.target));
    const label = group.members.length === 1 ? naturalLabel : `${naturalLabel} + ${group.members.length - 1} more`;
    const color = group.scope === "same-file" ? "#8E85FF" : "#D6409F";
    return {
      ...makeEdge(group.source, group.target, label, color),
      id: `dependency-${group.source}-${group.target}`,
      data: {
        dependency: true,
        dependencyScope: group.scope,
        count: group.members.length,
        primaryLabel: naturalLabel,
        members: group.members,
      },
      style: { stroke: color, strokeWidth: 2.4 },
    } satisfies Edge;
  });
}

function decorateDependencyCounts(
  nodes: Array<StructureNode | SemanticNode | FileContainerNode>,
  analysis: AnalysisResult,
  subsystemGroups: SubsystemGroup[],
) {
  const ownership = buildBehaviorOwnership(subsystemGroups);
  const counts = new Map<string, { incoming: number; outgoing: number }>();
  const add = (id: string | undefined, direction: "incoming" | "outgoing") => {
    if (!id) return;
    const current = counts.get(id) ?? { incoming: 0, outgoing: 0 };
    current[direction] += 1;
    counts.set(id, current);
  };
  analysis.edges.forEach((edge) => {
    const source = ownership.get(edge.source);
    const target = ownership.get(edge.target);
    add(edge.source, "outgoing");
    add(edge.target, "incoming");
    if (!source || !target) return;
    if (source.fileId !== target.fileId) { add(source.fileId, "outgoing"); add(target.fileId, "incoming"); }
    if (source.moduleId !== target.moduleId) { add(source.moduleId, "outgoing"); add(target.moduleId, "incoming"); }
    if (source.subsystemId !== target.subsystemId) { add(source.subsystemId, "outgoing"); add(target.subsystemId, "incoming"); }
  });
  counts.set("structure-root-system", { incoming: 0, outgoing: analysis.edges.length });
  return nodes.map((node) => {
    const semanticId = node.type === "semantic" ? node.data.semanticId : undefined;
    const count = counts.get(semanticId ?? node.id) ?? { incoming: 0, outgoing: 0 };
    return { ...node, data: { ...node.data, dependencyIn: count.incoming, dependencyOut: count.outgoing } };
  }) as Array<StructureNode | SemanticNode | FileContainerNode>;
}

function finalizeGraph(nodes: Array<StructureNode | SemanticNode | FileContainerNode | JourneyStageNode>, edges: Edge[]): GraphLayout {
  const inputs = new Map<string, string[]>();
  const outputs = new Map<string, string[]>();
  const portEdges = edges.map((edge, index) => {
    const handleKey = `${index}-${edge.id.replace(/[^a-z0-9-]+/gi, "-")}`;
    const sourceHandle = `out-${handleKey}`;
    const targetHandle = `in-${handleKey}`;
    outputs.set(edge.source, [...(outputs.get(edge.source) ?? []), sourceHandle]);
    inputs.set(edge.target, [...(inputs.get(edge.target) ?? []), targetHandle]);
    return { ...edge, sourceHandle, targetHandle };
  });
  const portNodes = nodes.map((node) => ({
    ...node,
    data: { ...node.data, inputHandles: inputs.get(node.id) ?? [], outputHandles: outputs.get(node.id) ?? [] },
  })) as Array<StructureNode | SemanticNode | FileContainerNode | JourneyStageNode>;
  return { nodes: portNodes, edges: portEdges };
}

function layoutExpandedGraph(
  repositoryName: string,
  analysis: AnalysisResult,
  subsystemGroups: SubsystemGroup[],
  selectedSubsystem: SubsystemGroup | null,
  selectedModule: ModuleGroup | null,
  selectedFile: FileGroup | null,
  focusedNodeId: string | null,
): GraphLayout {
  const nodes: Array<StructureNode | SemanticNode | FileContainerNode> = [];
  const graphEdges: Edge[] = [];
  const allFiles = new Set(subsystemGroups.flatMap((group) => group.files));
  const rootId = "structure-root-system";
  nodes.push({
    id: rootId,
    type: "subsystem",
    position: { x: 0, y: 0 },
    data: {
      structureId: "system",
      level: "system",
      title: repositoryName,
      path: "Repository",
      summary: "Repository map",
      conceptCount: analysis.nodes.length,
      fileCount: allFiles.size,
      lineCount: subsystemGroups.reduce((total, group) => total + group.lineCount, 0),
      kinds: [...new Set(subsystemGroups.flatMap((group) => group.kinds))],
      behavior: describeBehaviorKinds(analysis.nodes),
      revealIndex: 0,
    },
  });
  const finishLayout = (dependencyFocusId = focusedNodeId) => {
    const dependencyEdges = aggregateVisibleDependencyEdges(analysis, nodes, dependencyFocusId);
    const decoratedNodes = decorateDependencyCounts(nodes, analysis, subsystemGroups);
    return finalizeGraph(decoratedNodes, [...graphEdges, ...dependencyEdges]);
  };

  const subsystemY = new Map<string, number>();
  subsystemGroups.forEach((group, index) => {
    const y = centeredY(index, subsystemGroups.length, 0);
    subsystemY.set(group.id, y);
    nodes.push({
      id: group.id,
      type: "subsystem",
      position: { x: 780, y },
      data: { structureId: group.id, level: "subsystem", title: group.title, path: group.path, summary: "Subsystem", conceptCount: group.nodes.length, fileCount: group.files.length, lineCount: group.lineCount, kinds: group.kinds, behavior: describeBehaviorKinds(group.nodes), revealIndex: index },
    });
    graphEdges.push(structureEdge(rootId, group.id, "#8E85FF"));
  });

  if (!selectedSubsystem) return finishLayout();
  const selectedSubsystemY = subsystemY.get(selectedSubsystem.id) ?? 0;
  const moduleY = new Map<string, number>();
  selectedSubsystem.modules.forEach((module, index) => {
    const y = centeredY(index, selectedSubsystem.modules.length, selectedSubsystemY);
    moduleY.set(module.id, y);
    nodes.push({
      id: module.id,
      type: "subsystem",
      position: { x: 1560, y },
      data: { structureId: module.id, level: "module", title: module.title, path: module.path, summary: "Project folder", conceptCount: module.nodes.length, fileCount: module.files.length, lineCount: module.lineCount, kinds: module.kinds, behavior: describeBehaviorKinds(module.nodes), revealIndex: index },
    });
    graphEdges.push(structureEdge(selectedSubsystem.id, module.id, "#23AFD0"));
  });

  if (!selectedModule) return finishLayout();
  const selectedModuleY = moduleY.get(selectedModule.id) ?? selectedSubsystemY;
  if (!selectedFile) {
    selectedModule.files.forEach((file, index) => {
      const y = centeredY(index, selectedModule.files.length, selectedModuleY);
      nodes.push({
        id: file.id,
        type: "subsystem",
        position: { x: 2340, y },
        data: { structureId: file.id, level: "file", title: file.title, path: file.path, summary: "Source file", conceptCount: file.nodes.length, fileCount: 1, lineCount: file.lineCount, kinds: file.kinds, behavior: describeBehaviorKinds(file.nodes), revealIndex: index },
      });
      graphEdges.push(structureEdge(selectedModule.id, file.id, "#29A383"));
    });
    return finishLayout();
  }

  const behaviorIds = new Set(selectedFile.nodes.map((node) => node.id));
  const internalEdges = analysis.edges.filter((edge) => behaviorIds.has(edge.source) && behaviorIds.has(edge.target));
  const orderedBehaviors = rankBehaviorGraph(selectedFile.nodes, internalEdges).flat();
  const selectedBehavior = analysis.nodes.find((node) => node.id === focusedNodeId && behaviorIds.has(node.id)) ?? orderedBehaviors[0];
  const primaryBehaviors = selectedBehavior ? [selectedBehavior] : [];
  const primarySize = fileContainerLayout(primaryBehaviors, 1, selectedBehavior?.id);
  const directEdges = selectedBehavior
    ? analysis.edges.filter((edge) => edge.source === selectedBehavior.id || edge.target === selectedBehavior.id)
    : [];
  const internalRelatedIds = new Set(directEdges.flatMap((edge) => [edge.source, edge.target]).filter((id) => id !== selectedBehavior?.id && behaviorIds.has(id)));
  const primaryPosition = { x: directEdges.length ? 3300 : 2340, y: selectedModuleY - 72 };

  nodes.push({
    id: selectedFile.id,
    type: "fileContainer",
    position: primaryPosition,
    style: { width: primarySize.width, height: primarySize.height, zIndex: 0 },
    data: {
      structureId: selectedFile.id,
      title: selectedFile.title,
      path: selectedFile.path,
      context: "expanded",
      behaviorCount: selectedFile.nodes.length,
      relationCount: directEdges.length,
      internalRelationCount: internalRelatedIds.size,
      selectedBehaviorTitle: selectedBehavior?.data.codeIdentity || selectedBehavior?.data.title,
      selectedBehaviorIndex: Math.max(1, orderedBehaviors.findIndex((node) => node.id === selectedBehavior?.id) + 1),
    },
  });
  graphEdges.push(structureEdge(selectedModule.id, selectedFile.id, "#29A383"));

  primaryBehaviors.forEach((node, index) => {
    nodes.push({
      ...node,
      parentId: selectedFile.id,
      extent: "parent",
      position: primarySize.positions[index],
      style: { ...node.style, zIndex: 3 },
      data: {
        ...node.data,
        revealIndex: index,
        relationState: "selected",
      },
    });
  });

  if (selectedBehavior) {
    const dependenciesByGroup = new Map<string, {
      path: string;
      direction: "incoming" | "outgoing";
      scope: "same-file" | "cross-file";
      nodes: Map<string, SemanticNode>;
      relationCount: number;
    }>();
    directEdges.forEach((edge) => {
      const direction = edge.target === selectedBehavior.id ? "incoming" : "outgoing";
      const relatedId = direction === "incoming" ? edge.source : edge.target;
      const node = analysis.nodes.find((candidate) => candidate.id === relatedId);
      if (!node) return;
      const scope = behaviorIds.has(relatedId) ? "same-file" : "cross-file";
      const path = scope === "same-file" ? selectedFile.path : primaryFileForNode(node);
      const key = `${scope}|${direction}|${path}`;
      const current = dependenciesByGroup.get(key) ?? { path, direction, scope, nodes: new Map<string, SemanticNode>(), relationCount: 0 };
      current.nodes.set(node.id, node);
      current.relationCount += 1;
      dependenciesByGroup.set(key, current);
    });

    const relatedGroups = [...dependenciesByGroup.values()]
      .sort((a, b) => a.direction.localeCompare(b.direction) || a.scope.localeCompare(b.scope) || a.path.localeCompare(b.path))
      .map((group) => {
        const relatedNodes = [...group.nodes.values()].sort((a, b) => a.data.title.localeCompare(b.data.title));
        return { ...group, relatedNodes, size: fileContainerLayout(relatedNodes, 1, undefined, true) };
      });
    const relatedGap = 260;
    const selectedAbsoluteY = primaryPosition.y + (primarySize.positions[0]?.y ?? FILE_GROUP_HEADER);
    const sideCursor = new Map<"incoming" | "outgoing", number>();
    (["incoming", "outgoing"] as const).forEach((direction) => {
      const sideGroups = relatedGroups.filter((group) => group.direction === direction);
      const totalHeight = sideGroups.reduce((total, group) => total + group.size.height, 0) + Math.max(0, sideGroups.length - 1) * relatedGap;
      sideCursor.set(direction, selectedAbsoluteY - totalHeight / 2);
    });

    relatedGroups.forEach((group, groupIndex) => {
      const safePath = group.path.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const groupId = `dependency-file-${group.scope}-${group.direction}-${safePath}`;
      const relatedY = sideCursor.get(group.direction) ?? selectedAbsoluteY;
      const laneGap = 320;
      const relatedX = group.direction === "incoming"
        ? primaryPosition.x - group.size.width - laneGap
        : primaryPosition.x + primarySize.width + laneGap;
      nodes.push({
        id: groupId,
        type: "fileContainer",
        position: { x: relatedX, y: relatedY },
        style: { width: group.size.width, height: group.size.height, zIndex: 0 },
        data: {
          structureId: groupId,
          title: group.path.split("/").pop() || group.path,
          path: group.path,
          context: group.scope === "same-file" ? "internal" : "related",
          behaviorCount: group.relatedNodes.length,
          relationCount: group.relationCount,
          selectedBehaviorTitle: selectedBehavior.data.codeIdentity || selectedBehavior.data.title,
          flowDirection: group.direction,
        },
      });
      group.relatedNodes.forEach((node, index) => nodes.push({
          ...node,
          id: `${groupId}--${node.id}`,
          parentId: groupId,
          extent: "parent",
          position: group.size.positions[index],
          style: { ...node.style, zIndex: 3 },
          data: {
            ...node.data,
            semanticId: node.id,
            dependencyDirection: group.direction,
            revealIndex: groupIndex + index,
            relationState: group.scope === "same-file" ? "internal" : "related",
          },
        }));
      sideCursor.set(group.direction, relatedY + group.size.height + relatedGap);
    });
  }
  return finishLayout(selectedBehavior?.id ?? null);
}

function layoutSystemBehaviorGraph(
  analysis: AnalysisResult,
  ownership: Map<string, BehaviorOwnership>,
  focusedNodeId: string | null,
  journeyNodeIds: string[] = [],
  stagePlan?: JourneyStagePlan,
  selectedBehaviorId?: string,
): GraphLayout {
  const nodeById = new Map(analysis.nodes.map((node) => [node.id, node]));
  const validEdges = analysis.edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target) && edge.source !== edge.target);
  const degree = new Map<string, { incoming: number; outgoing: number; crossFile: number; crossModule: number }>();
  const crossModuleAdjacency = new Map<string, Set<string>>();
  const bump = (id: string, direction: "incoming" | "outgoing", crossFile: boolean, crossModule: boolean) => {
    const current = degree.get(id) ?? { incoming: 0, outgoing: 0, crossFile: 0, crossModule: 0 };
    current[direction] += 1;
    if (crossFile) current.crossFile += 1;
    if (crossModule) current.crossModule += 1;
    degree.set(id, current);
  };
  validEdges.forEach((edge) => {
    const sourceOwner = ownership.get(edge.source);
    const targetOwner = ownership.get(edge.target);
    const crossFile = Boolean(sourceOwner && targetOwner && sourceOwner.fileId !== targetOwner.fileId);
    const crossModule = Boolean(sourceOwner && targetOwner && sourceOwner.moduleId !== targetOwner.moduleId);
    bump(edge.source, "outgoing", crossFile, crossModule);
    bump(edge.target, "incoming", crossFile, crossModule);
    if (crossModule) {
      crossModuleAdjacency.set(edge.source, new Set([...(crossModuleAdjacency.get(edge.source) ?? []), edge.target]));
      crossModuleAdjacency.set(edge.target, new Set([...(crossModuleAdjacency.get(edge.target) ?? []), edge.source]));
    }
  });
  const kindWeight: Record<SemanticKind, number> = {
    contract: 10,
    routing: 9,
    flow: 9,
    state: 7,
    fallback: 7,
    error: 7,
    output: 6,
    config: 5,
    test: 2,
    structure: 3,
    unknown: 1,
  };
  const score = (node: SemanticNode) => {
    const counts = degree.get(node.id) ?? { incoming: 0, outgoing: 0, crossFile: 0, crossModule: 0 };
    return (counts.incoming + counts.outgoing) * 7 + counts.crossFile * 5 + counts.crossModule * 22 + kindWeight[node.data.kind];
  };
  const scopeFor = (source: string, target: string): "same-file" | "cross-file" => {
    const sourceOwner = ownership.get(source);
    const targetOwner = ownership.get(target);
    return sourceOwner && targetOwner && sourceOwner.fileId === targetOwner.fileId ? "same-file" : "cross-file";
  };
  const makeHldEdge = (source: string, target: string, members: DependencyMember[], scope: "same-file" | "cross-file") => {
    const labels = new Map<string, number>();
    members.forEach((member) => labels.set(member.label, (labels.get(member.label) ?? 0) + 1));
    const primary = [...labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "DEPENDS ON";
    const representative = members.find((member) => member.label === primary) ?? members[0];
    const naturalLabel = plainDependencyLabel(primary, nodeById.get(representative?.target));
    const label = members.length === 1 ? naturalLabel : `${naturalLabel} + ${members.length - 1} more`;
    const color = scope === "same-file" ? "#8E85FF" : "#D6409F";
    return {
      ...makeEdge(source, target, label, color),
      id: `hld-edge-${source}-${target}`,
      data: { dependency: true, dependencyScope: scope, count: members.length, primaryLabel: naturalLabel, members },
      style: { stroke: color, strokeWidth: 2.5 },
    } satisfies Edge;
  };

  const focused = focusedNodeId ? nodeById.get(focusedNodeId) : undefined;
  if (focused && journeyNodeIds.length > 1) {
    const journeyIds = new Set([...journeyNodeIds, focused.id]);
    const journeyNodes = analysis.nodes.filter((node) => journeyIds.has(node.id));
    const pairGroups = new Map<string, DependencyMember[]>();
    validEdges.forEach((edge) => {
      if (!journeyIds.has(edge.source) || !journeyIds.has(edge.target)) return;
      const key = `${edge.source}|${edge.target}`;
      pairGroups.set(key, [...(pairGroups.get(key) ?? []), { source: edge.source, target: edge.target, label: String(edge.label || "DEPENDS ON") }]);
    });
    const candidateEdges = [...pairGroups.entries()].map(([key, members]) => {
      const [source, target] = key.split("|");
      return makeHldEdge(source, target, members, scopeFor(source, target));
    });
    const ranks = rankBehaviorGraph(journeyNodes, candidateEdges, Math.max(12, journeyNodes.length));
    const rankById = new Map<string, number>();
    ranks.forEach((rank, rankIndex) => rank.forEach((node) => rankById.set(node.id, rankIndex)));
    const forwardEdges = candidateEdges.filter((edge) => (rankById.get(edge.source) ?? 0) < (rankById.get(edge.target) ?? 0));
    const connectedIds = new Set(journeyNodes.map((node) => node.id));
    const visibleNodes = journeyNodes;
    const fallbackPlan = fallbackJourneyStagePlan({ id: stagePlan?.journeyId ?? "visible-journey", anchorId: focused.id, title: focused.data.title, description: "", nodeIds: visibleNodes.map((node) => node.id), contracts: [] }, analysis);
    const effectivePlan = stagePlan && stagePlan.steps.length ? stagePlan : fallbackPlan;
    const validSteps = effectivePlan.steps.filter((step) => connectedIds.has(step.nodeId));
    const stepById = new Map(validSteps.map((step) => [step.nodeId, step]));
    const journeyEdges = forwardEdges.map((edge) => {
      const sourceStage = stepById.get(edge.source)?.stage;
      const targetStage = stepById.get(edge.target)?.stage;
      const branchStage = ([targetStage, sourceStage].find((stage) => stage === "async" || stage === "fallback" || stage === "error")) as JourneyStage | undefined;
      if (!branchStage) return edge;
      const color = branchStage === "error" ? "#EC5D5E" : branchStage === "fallback" ? "#FFCA16" : "#23AFD0";
      return {
        ...edge,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { ...edge.style, stroke: color, strokeDasharray: branchStage === "async" ? "13 10" : "9 8" },
        data: { ...(edge.data ?? {}), journeyBranch: branchStage },
      } satisfies Edge;
    });
    const journeyPositions = new Map<string, { x: number; y: number }>();
    const stageGroups: JourneyStageNode[] = [];
    const usedStages = JOURNEY_STAGE_ORDER.filter((stage) => validSteps.some((step) => step.stage === stage));
    const stageRank = (stage: JourneyStage) => {
      const values = visibleNodes.filter((node) => stepById.get(node.id)?.stage === stage).map((node) => rankById.get(node.id) ?? 0).sort((left, right) => left - right);
      return values.length ? values[Math.floor(values.length / 2)] : JOURNEY_STAGE_ORDER.indexOf(stage);
    };
    const preferredStages = [...usedStages].sort((left, right) => stageRank(left) - stageRank(right) || JOURNEY_STAGE_ORDER.indexOf(left) - JOURNEY_STAGE_ORDER.indexOf(right));
    const branchStages = new Set<JourneyStage>(["async", "fallback", "error"]);
    const orderedStages = [
      ...preferredStages.filter((stage) => !branchStages.has(stage)),
      ...preferredStages.filter((stage) => branchStages.has(stage)),
    ];
    const stageHeader = 108;
    const edgeRail = 80;
    const stagePadding = 68;
    const verticalStageGap = 300;
    const rankColumnGap = 380;
    const rankColumnStep = BEHAVIOR_CARD_WIDTH + rankColumnGap;
    const sameRankCardGap = 170;
    const contentAllowance = 210;
    const stageLayouts = new Map<JourneyStage, { x: number; y: number; width: number; height: number; minRank: number; nodes: SemanticNode[] }>();
    let stageCursorY = 120;
    orderedStages.forEach((stage) => {
      const stageNodes = visibleNodes.filter((node) => stepById.get(node.id)?.stage === stage)
        .sort((left, right) => (rankById.get(left.id) ?? 0) - (rankById.get(right.id) ?? 0) || (stepById.get(left.id)?.sequence ?? 0) - (stepById.get(right.id)?.sequence ?? 0));
      const ranksInStage = stageNodes.map((node) => rankById.get(node.id) ?? 0);
      const minRank = Math.min(...ranksInStage);
      const maxRank = Math.max(...ranksInStage);
      const rankGroups = new Map<number, SemanticNode[]>();
      stageNodes.forEach((node) => {
        const rank = rankById.get(node.id) ?? 0;
        rankGroups.set(rank, [...(rankGroups.get(rank) ?? []), node]);
      });
      const tallestColumn = Math.max(360, ...[...rankGroups.values()].map((nodesInRank) => (
        nodesInRank.reduce((height, node) => height + estimatedBehaviorHeight(node, true) + contentAllowance, 0)
          + Math.max(0, nodesInRank.length - 1) * sameRankCardGap
      )));
      const stageWidth = stagePadding * 2 + (maxRank - minRank) * rankColumnStep + BEHAVIOR_CARD_WIDTH;
      const stageHeight = stageHeader + edgeRail + stagePadding * 2 + tallestColumn;
      stageLayouts.set(stage, { x: minRank * rankColumnStep, y: stageCursorY, width: stageWidth, height: stageHeight, minRank, nodes: stageNodes });
      stageCursorY += stageHeight + verticalStageGap;
    });
    orderedStages.forEach((stage) => {
      const layout = stageLayouts.get(stage)!;
      const rankCursors = new Map<number, number>();
      layout.nodes.forEach((node) => {
        const rank = rankById.get(node.id) ?? 0;
        const y = rankCursors.get(rank) ?? layout.y + stageHeader + edgeRail + stagePadding;
        journeyPositions.set(node.id, {
          x: layout.x + stagePadding + (rank - layout.minRank) * rankColumnStep,
          y,
        });
        rankCursors.set(rank, y + estimatedBehaviorHeight(node, true) + contentAllowance + sameRankCardGap);
      });
      const copy = JOURNEY_STAGE_COPY[stage];
      stageGroups.push({
        id: `journey-stage-${stage}`,
        type: "journeyStage",
        position: { x: layout.x, y: layout.y },
        selectable: false,
        draggable: false,
        connectable: false,
        style: { width: layout.width, height: layout.height, zIndex: -2 },
        data: { stage, title: copy.title, description: copy.description, count: layout.nodes.length, active: layout.nodes.some((node) => node.id === selectedBehaviorId) },
      });
    });
    const graphNodes = visibleNodes.map((node, index) => ({
          ...node,
          position: journeyPositions.get(node.id) ?? { x: (rankById.get(node.id) ?? 0) * 920, y: index * 520 + 160 },
          style: { ...node.style, zIndex: node.id === selectedBehaviorId ? 4 : 3 },
          data: {
            ...node.data,
            semanticId: node.id,
            sourcePath: primaryFileForNode(node),
            showSourcePath: true,
            revealIndex: index,
            relationState: node.id === selectedBehaviorId ? "selected" as const : "related" as const,
            dependencyIn: degree.get(node.id)?.incoming ?? 0,
            dependencyOut: degree.get(node.id)?.outgoing ?? 0,
          },
        }));
    if (graphNodes.length > 1 && journeyEdges.length) return finalizeGraph([...stageGroups, ...graphNodes], journeyEdges);
  }
  if (focused) {
    const groups = new Map<string, {
      direction: "incoming" | "outgoing";
      relatedId: string;
      members: DependencyMember[];
      scope: "same-file" | "cross-file";
    }>();
    validEdges.forEach((edge) => {
      if (edge.source !== focused.id && edge.target !== focused.id) return;
      const direction = edge.target === focused.id ? "incoming" : "outgoing";
      const relatedId = direction === "incoming" ? edge.source : edge.target;
      const key = `${direction}|${relatedId}`;
      const current = groups.get(key) ?? { direction, relatedId, members: [], scope: scopeFor(edge.source, edge.target) };
      current.members.push({ source: edge.source, target: edge.target, label: String(edge.label || "DEPENDS ON") });
      groups.set(key, current);
    });
    const sides = (["incoming", "outgoing"] as const).map((direction) => ({
      direction,
      groups: [...groups.values()]
        .filter((group) => group.direction === direction)
        .sort((a, b) => b.members.length - a.members.length || (nodeById.get(a.relatedId)?.data.title ?? "").localeCompare(nodeById.get(b.relatedId)?.data.title ?? "")),
    }));
    const sideGap = 170;
    const sideHeight = (items: typeof sides[number]["groups"]) => items.reduce((total, group) => {
      const node = nodeById.get(group.relatedId);
      return total + (node ? estimatedBehaviorHeight(node, true) + 76 : 0);
    }, 0) + Math.max(0, items.length - 1) * sideGap;
    const selectedHeight = estimatedBehaviorHeight(focused, true) + 76;
    const maxHeight = Math.max(selectedHeight, ...sides.map((side) => sideHeight(side.groups)));
    const centerY = 140 + maxHeight / 2;
    const graphNodes: Array<StructureNode | SemanticNode | FileContainerNode> = [{
      ...focused,
      position: { x: 940, y: centerY - selectedHeight / 2 },
      style: { ...focused.style, zIndex: 3 },
      data: {
        ...focused.data,
        sourcePath: primaryFileForNode(focused),
        showSourcePath: true,
        relationState: "selected",
        dependencyIn: degree.get(focused.id)?.incoming ?? 0,
        dependencyOut: degree.get(focused.id)?.outgoing ?? 0,
      },
    }];
    const graphEdges: Edge[] = [];
    sides.forEach((side) => {
      let cursorY = centerY - sideHeight(side.groups) / 2;
      side.groups.forEach((group, index) => {
        const related = nodeById.get(group.relatedId);
        if (!related) return;
        const visualId = `hld-${side.direction}-${related.id}`;
        const height = estimatedBehaviorHeight(related, true) + 76;
        graphNodes.push({
          ...related,
          id: visualId,
          position: { x: side.direction === "incoming" ? 0 : 1880, y: cursorY },
          style: { ...related.style, zIndex: 3 },
          data: {
            ...related.data,
            semanticId: related.id,
            sourcePath: primaryFileForNode(related),
            showSourcePath: true,
            dependencyDirection: side.direction,
            revealIndex: index,
            relationState: group.scope === "same-file" ? "internal" : "related",
            dependencyIn: degree.get(related.id)?.incoming ?? 0,
            dependencyOut: degree.get(related.id)?.outgoing ?? 0,
          },
        });
        const source = side.direction === "incoming" ? visualId : focused.id;
        const target = side.direction === "incoming" ? focused.id : visualId;
        graphEdges.push(makeHldEdge(source, target, group.members, group.scope));
        cursorY += height + sideGap;
      });
    });
    return finalizeGraph(graphNodes, graphEdges);
  }

  const adjacency = new Map<string, Set<string>>();
  validEdges.forEach((edge) => {
    adjacency.set(edge.source, new Set([...(adjacency.get(edge.source) ?? []), edge.target]));
    adjacency.set(edge.target, new Set([...(adjacency.get(edge.target) ?? []), edge.source]));
  });
  const ranked = analysis.nodes
    .filter((node) => (degree.get(node.id)?.incoming ?? 0) + (degree.get(node.id)?.outgoing ?? 0) > 0)
    .sort((a, b) => score(b) - score(a) || a.data.title.localeCompare(b.data.title));
  const chosen = new Set<string>();
  const representedSubsystems = new Set<string>();
  ranked.forEach((node) => {
    const subsystem = ownership.get(node.id)?.subsystemId;
    if (!subsystem || representedSubsystems.has(subsystem) || chosen.size >= 8) return;
    representedSubsystems.add(subsystem);
    chosen.add(node.id);
  });
  ranked.slice(0, 10).forEach((node) => chosen.add(node.id));
  const queue = [...chosen];
  while (queue.length && chosen.size < 32) {
    const current = queue.shift()!;
    const neighbors = [...new Set([...(crossModuleAdjacency.get(current) ?? []), ...(adjacency.get(current) ?? [])])]
      .map((id) => nodeById.get(id))
      .filter((node): node is SemanticNode => Boolean(node))
      .sort((a, b) => score(b) - score(a));
    neighbors.forEach((node) => {
      if (chosen.size >= 32 || chosen.has(node.id)) return;
      chosen.add(node.id);
      queue.push(node.id);
    });
  }
  ranked.forEach((node) => { if (chosen.size < 32) chosen.add(node.id); });
  const selectedNodes = analysis.nodes.filter((node) => chosen.has(node.id));
  const pairGroups = new Map<string, DependencyMember[]>();
  validEdges.forEach((edge) => {
    if (!chosen.has(edge.source) || !chosen.has(edge.target)) return;
    const key = `${edge.source}|${edge.target}`;
    pairGroups.set(key, [...(pairGroups.get(key) ?? []), { source: edge.source, target: edge.target, label: String(edge.label || "DEPENDS ON") }]);
  });
  const candidateHldEdges = [...pairGroups.entries()]
    .map(([key, members]) => {
      const [source, target] = key.split("|");
      return makeHldEdge(source, target, members, scopeFor(source, target));
    })
    .sort((a, b) => Number((b.data as DependencyEdgeData).count ?? 0) - Number((a.data as DependencyEdgeData).count ?? 0))
    .slice(0, 84);
  const ranks = rankBehaviorGraph(selectedNodes, candidateHldEdges);
  const rankById = new Map<string, number>();
  ranks.forEach((rank, rankIndex) => rank.forEach((node) => rankById.set(node.id, rankIndex)));
  const hldEdges = candidateHldEdges.filter((edge) => (rankById.get(edge.source) ?? 0) < (rankById.get(edge.target) ?? 0));
  const connectedHldIds = new Set(hldEdges.flatMap((edge) => [edge.source, edge.target]));
  const visibleRanks = hldEdges.length ? ranks.map((rank) => rank.filter((node) => connectedHldIds.has(node.id))) : ranks;
  const overviewPositions = arrangeHldRanks(visibleRanks, hldEdges, true);
  const graphNodes = visibleRanks.flatMap((rank, rankIndex) => rank.map((node, index) => ({
    ...node,
    position: overviewPositions.get(node.id) ?? { x: rankIndex * 820, y: index * 370 + 160 },
    data: {
      ...node.data,
      sourcePath: primaryFileForNode(node),
      showSourcePath: true,
      revealIndex: rankIndex + index,
      relationState: "compact" as const,
      dependencyIn: degree.get(node.id)?.incoming ?? 0,
      dependencyOut: degree.get(node.id)?.outgoing ?? 0,
    },
  })));
  return finalizeGraph(graphNodes, hldEdges);
}

function GraphEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, label, data }: EdgeProps) {
  const visual = (data ?? {}) as DependencyEdgeData & { showLabel?: boolean; dimmed?: boolean; active?: boolean };
  const horizontalSpan = Math.abs(targetX - sourceX);
  const verticalSpan = Math.abs(targetY - sourceY);
  const controlDistance = Math.min(360, Math.max(96, horizontalSpan * .38));
  const alternatingDirection = [...id].reduce((total, character) => total + character.charCodeAt(0), 0) % 2 ? 1 : -1;
  const bow = verticalSpan < 32
    ? Math.min(132, Math.max(46, horizontalSpan * .12)) * alternatingDirection
    : Math.min(92, Math.max(22, horizontalSpan * .045 + verticalSpan * .055)) * (targetY > sourceY ? -1 : 1);
  const sourceControl = sourcePosition === Position.Left
    ? { x: sourceX - controlDistance, y: sourceY + bow }
    : sourcePosition === Position.Top
      ? { x: sourceX + bow, y: sourceY - controlDistance }
      : sourcePosition === Position.Bottom
        ? { x: sourceX + bow, y: sourceY + controlDistance }
        : { x: sourceX + controlDistance, y: sourceY + bow };
  const targetControl = targetPosition === Position.Right
    ? { x: targetX + controlDistance, y: targetY + bow }
    : targetPosition === Position.Top
      ? { x: targetX + bow, y: targetY - controlDistance }
      : targetPosition === Position.Bottom
        ? { x: targetX + bow, y: targetY + controlDistance }
        : { x: targetX - controlDistance, y: targetY + bow };
  const path = `M ${sourceX},${sourceY} C ${sourceControl.x},${sourceControl.y} ${targetControl.x},${targetControl.y} ${targetX},${targetY}`;
  const labelX = (sourceX + 3 * sourceControl.x + 3 * targetControl.x + targetX) / 8;
  const labelY = (sourceY + 3 * sourceControl.y + 3 * targetControl.y + targetY) / 8;

  return (
    <>
      <BaseEdge id={`${id}-halo`} path={path} style={{ stroke: "#1E1E1E", strokeWidth: visual.active ? 10 : 8, opacity: visual.dimmed ? .3 : .98 }} />
      <BaseEdge id={id} className={`graph-edge-path ${visual.dependency ? "dependency-edge" : ""} ${visual.dependencyScope === "same-file" ? "same-file-dependency" : ""}`} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: style?.strokeWidth ?? 1.7, strokeDasharray: style?.strokeDasharray ?? (visual.dependency ? undefined : "7 8") }} />
      {label && visual.showLabel ? (
        <EdgeLabelRenderer>
          <span className="graph-edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{String(label)}</span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function buildDemoGraph(stage: ReviewStage, content: string, source = "Demo analysis") : AnalysisResult {
  const inventory = stage === "baseline" ? parseSource(content) : parseDiff(content);
  const groups = new Map<SemanticKind, CodeLine[]>();
  for (const line of inventory) {
    const kind = stage === "baseline" ? classifySourceLine(line) : classifyDiffLine(line);
    groups.set(kind, [...(groups.get(kind) ?? []), line]);
  }

  const nodes: SemanticNode[] = [...groups.entries()].map(([kind, lines]) => {
    const baseline = BASELINE_META[kind];
    const change = CHANGE_META[kind];
    return {
      id: kind,
      type: "semantic",
      position: stage === "baseline" ? BASELINE_POSITIONS[kind] : CHANGE_POSITIONS[kind],
      data: {
        stage,
        title: stage === "baseline" ? baseline.title : change.title,
        codeIdentity: deriveCodeIdentity(lines),
        kind,
        summary: stage === "baseline" ? baseline.summary : change.summary,
        before: stage === "baseline" ? "" : change.before,
        after: stage === "baseline" ? "" : change.after,
        sourceCode: formatLines(lines),
        beforeCode: formatLines(lines, "old"),
        afterCode: formatLines(lines, "new"),
        lineIds: lines.map((line) => line.id),
        confidence: stage === "baseline" ? baseline.confidence : change.confidence,
        provides: [],
        uses: [],
      },
    };
  });

  const ids = new Set(nodes.map((node) => node.id));
  const candidates = stage === "baseline"
    ? [
        makeEdge("structure", "contract", "DECLARES", "#65aee0"),
        makeEdge("contract", "flow", "SUPPLIES", "#65aee0"),
        makeEdge("flow", "routing", "ON ERROR", "#d0c65f"),
        makeEdge("routing", "output", "RETURNS", "#d0c65f"),
        makeEdge("config", "flow", "CONTROLS"),
        makeEdge("test", "flow", "PROVES"),
      ]
    : [
        makeEdge("contract", "routing", "CHANGES INPUTS", "#65aee0"),
        makeEdge("routing", "error", "OTHER ERRORS", "#d67974"),
        makeEdge("routing", "fallback", "ON TIMEOUT", "#7ec49d"),
        makeEdge("fallback", "state", "ON FAILURE", "#7ec49d"),
        makeEdge("state", "output", "CACHE MISS", "#7ec49d"),
        makeEdge("config", "fallback", "CONFIGURES", "#d0c65f"),
        makeEdge("fallback", "test", "PROVED BY"),
        makeEdge("state", "test", "PROVED BY"),
      ];

  const edges = candidates.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const unknown = groups.get("unknown")?.length ?? 0;
  return { stage, nodes, edges, inventory, classified: inventory.length - unknown, unknown, source };
}

function materializeAiGraph(stage: ReviewStage, content: string, ai: AiAnalysis, source: string, finalizeCoverage = true): AnalysisResult {
  const inventory = stage === "baseline" ? parseSource(content) : parseDiff(content);
  const byId = new Map(inventory.map((line) => [line.id, line]));
  const claimed = new Set<string>();
  const normalized = new Map<string, string>();

  const nodes: SemanticNode[] = (Array.isArray(ai.nodes) ? ai.nodes : []).map((raw, index) => {
    const id = `ai-${index}-${String(raw.id || "change").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
    normalized.set(raw.id, id);
    const lineIds = (Array.isArray(raw.lineIds) ? raw.lineIds : []).filter((lineId) => {
      if (!byId.has(lineId) || claimed.has(lineId)) return false;
      claimed.add(lineId);
      return true;
    });
    const lines = lineIds.map((lineId) => byId.get(lineId)!).filter(Boolean);
    const kind = Object.prototype.hasOwnProperty.call(BASELINE_META, raw.kind) ? raw.kind : "unknown";
    return {
      id,
      type: "semantic" as const,
      position: { x: (index % 3) * 310, y: Math.floor(index / 3) * 220 + (index % 2) * 24 },
      data: {
        stage,
        title: raw.title || "Semantic concept",
        codeIdentity: raw.codeIdentity || deriveCodeIdentity(lines),
        kind,
        summary: raw.summary || raw.after || "Meaning not provided",
        before: raw.before || "Earlier behavior",
        after: raw.after || "New behavior",
        sourceCode: formatLines(lines),
        beforeCode: formatLines(lines, "old"),
        afterCode: formatLines(lines, "new"),
        lineIds,
        confidence: raw.confidence || "medium",
        provides: Array.isArray(raw.provides) ? raw.provides : [],
        uses: Array.isArray(raw.uses) ? raw.uses : [],
      },
    } satisfies SemanticNode;
  }).filter((node) => node.data.lineIds.length > 0);

  const unclaimed = inventory.filter((line) => !claimed.has(line.id));
  if (finalizeCoverage && unclaimed.length) {
    nodes.push({
      id: "ai-unclassified",
      type: "semantic",
      position: { x: 0, y: Math.ceil(nodes.length / 3) * 220 + 50 },
      data: {
        stage,
        title: stage === "baseline" ? "Needs inspection" : "Unclassified change",
        codeIdentity: deriveCodeIdentity(unclaimed),
        kind: "unknown",
        summary: "The AI did not establish a safe semantic owner for these lines.",
        before: "Meaning not established",
        after: "Human inspection required",
        sourceCode: formatLines(unclaimed),
        beforeCode: formatLines(unclaimed, "old"),
        afterCode: formatLines(unclaimed, "new"),
        lineIds: unclaimed.map((line) => line.id),
        confidence: "low",
        provides: [],
        uses: [],
      },
    });
  }

  const valid = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(ai.edges) ? ai.edges : []).map((edge, index) => ({
    ...makeEdge(normalized.get(edge.source) ?? edge.source, normalized.get(edge.target) ?? edge.target, edge.label || "RELATES TO"),
    id: `ai-edge-${index}`,
  })).filter((edge) => valid.has(edge.source) && valid.has(edge.target));

  const explicitUnknown = nodes
    .filter((node) => node.data.kind === "unknown")
    .reduce((total, node) => total + node.data.lineIds.length, 0);
  return {
    stage,
    nodes,
    edges,
    inventory,
    classified: claimed.size,
    unknown: explicitUnknown,
    source,
  };
}

function NodePortHandles({ inputs = [], outputs = [] }: { inputs?: string[]; outputs?: string[] }) {
  return (
    <>
      {inputs.map((id, index) => <Handle key={id} id={id} type="target" position={Position.Left} style={{ top: `${((index + 1) / (inputs.length + 1)) * 100}%` }} />)}
      {outputs.map((id, index) => <Handle key={id} id={id} type="source" position={Position.Right} style={{ top: `${((index + 1) / (outputs.length + 1)) * 100}%` }} />)}
    </>
  );
}

function SemanticNodeView({ id, data, selected }: NodeProps<SemanticNode>) {
  const isBaseline = data.stage === "baseline";
  const animationDelay = `${Math.min(data.revealIndex ?? 0, 10) * 42}ms`;
  const sourcePath = data.sourcePath?.replaceAll("\\", "/") ?? "";
  const sourceParts = sourcePath.split("/");
  const sourceFile = sourceParts.pop() || sourcePath;
  const sourceDirectory = sourceParts.join("/");
  return (
    <div className={`semantic-node kind-${data.kind} relation-${data.relationState ?? "compact"} ${isBaseline ? "is-baseline" : "is-change"} ${selected ? "is-selected" : ""} ${data.collapsed ? "is-collapsed" : "is-expanded"}`} style={{ animationDelay }}>
      <NodePortHandles inputs={data.inputHandles} outputs={data.outputHandles} />
      <header className="node-panel-header">
        <i aria-hidden="true" />
        <div className="node-title-stack">
          {data.showSourcePath && sourcePath ? (
            <span className="node-source-path" title={sourcePath}>
              <b>{sourceFile}</b>
              {sourceDirectory ? <small>{sourceDirectory}/</small> : null}
            </span>
          ) : null}
          <span className="node-code-identity">{data.codeIdentity || "Code section"}</span>
          <h3>{data.title}</h3>
        </div>
        <div className="node-header-meta">
          <span>{data.kind}{(data.dependencyIn ?? 0) + (data.dependencyOut ?? 0) > 0 ? ` · ${(data.dependencyIn ?? 0) + (data.dependencyOut ?? 0)} links` : ""}</span>
          <button
            type="button"
            className="node-collapse-button nodrag nopan"
            aria-expanded={!data.collapsed}
            aria-label={`${data.collapsed ? "Expand" : "Collapse"} ${data.title}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleCollapsed?.(data.semanticId || id);
            }}
          >
            {data.collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
            <span>{data.collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </header>
      {data.relationState === "internal" ? <span className="internal-relation-tag"><i />Same-file relation</span> : null}
      <p className="compact-behavior-preview">{isBaseline ? data.summary : data.after}</p>
      {isBaseline ? (
        <div className="node-info-row"><span>Behavior</span><p>{data.summary}</p></div>
      ) : (
        <div className="node-delta">
          <span>{data.before}</span><b>→</b><span>{data.after}</span>
        </div>
      )}
      <div className="node-footer"><span>{data.lineIds.length} lines</span><span>{isBaseline ? "existing" : "changed"}</span></div>
    </div>
  );
}

function StructureNodeView({ data, selected }: NodeProps<StructureNode>) {
  const animationDelay = `${Math.min(data.revealIndex ?? 0, 10) * 42}ms`;
  return (
    <div className={`subsystem-node level-${data.level} ${selected ? "is-selected" : ""}`} style={{ animationDelay }}>
      <NodePortHandles inputs={data.inputHandles} outputs={data.outputHandles} />
      <header className="node-panel-header">
        <i aria-hidden="true" />
        <h3>{data.title}</h3>
        <span>{data.level}{(data.dependencyIn ?? 0) + (data.dependencyOut ?? 0) > 0 ? ` · ${(data.dependencyIn ?? 0) + (data.dependencyOut ?? 0)} links` : ""}</span>
      </header>
      <div className="node-info-row"><span>Path</span><code>{data.path}</code></div>
      <div className="node-info-row"><span>Behavior</span><p>{data.behavior}</p></div>
    </div>
  );
}

function FileContainerView({ data }: NodeProps<FileContainerNode>) {
  const expanded = data.context === "expanded";
  const internal = data.context === "internal";
  const directionLabel = data.flowDirection === "incoming" ? "Provides to selected" : "Receives from selected";
  const eyebrow = internal ? `Same file · ${directionLabel}` : expanded ? "Behavior gallery" : directionLabel;
  return (
    <section className={`file-container-node context-${data.context} ${data.flowDirection ? `flow-${data.flowDirection}` : ""}`}>
      {(data.inputHandles ?? []).map((id, index) => <Handle key={id} id={id} type="target" position={Position.Left} style={{ top: 72 + index * 18 }} />)}
      {(data.outputHandles ?? []).map((id, index) => <Handle key={id} id={id} type="source" position={Position.Right} style={{ top: 72 + index * 18 }} />)}
      <header>
        <div className="file-container-title">
          <span>{eyebrow}</span>
          <h3>{data.title}</h3>
          <code>{data.path}</code>
        </div>
        <div className="file-container-state">
          <strong>{expanded && data.selectedBehaviorIndex ? `${data.selectedBehaviorIndex}/${data.behaviorCount}` : data.behaviorCount}</strong>
          <span>{expanded ? "behavior in focus" : internal ? "same-file behaviors" : "related behaviors shown"}</span>
        </div>
      </header>
      <div className="file-context-note">
        <i aria-hidden="true" />
        {expanded
          ? <><b>{data.selectedBehaviorTitle || "Selected behavior"}</b> · {data.internalRelationCount || 0} same-file and {Math.max(0, data.relationCount - (data.internalRelationCount || 0))} cross-file relationship{data.relationCount === 1 ? "" : "s"}</>
          : internal
            ? <>Defined in this file and {data.flowDirection === "incoming" ? "supplies" : "receives from"} <b>{data.selectedBehaviorTitle || "the selected behavior"}</b></>
            : <>{data.flowDirection === "incoming" ? "Supplies behavior to" : "Receives behavior from"} <b>{data.selectedBehaviorTitle || "the selected behavior"}</b></>}
        {!expanded ? <> · {data.relationCount} exact relationship{data.relationCount === 1 ? "" : "s"}</> : null}
      </div>
    </section>
  );
}

function JourneyStageView({ data }: NodeProps<JourneyStageNode>) {
  return (
    <section className={`journey-stage-node stage-${data.stage} ${data.active ? "is-active" : ""}`} aria-label={`${data.title} stage with ${data.count} behaviors`}>
      <header>
        <span>{data.title}</span>
        <b>{data.count}</b>
      </header>
      <p>{data.description}</p>
    </section>
  );
}

function GraphInternalsSync({ nodeIds, enabled, syncKey }: { nodeIds: string[]; enabled: boolean; syncKey: string }) {
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    if (!enabled || !nodeIds.length) return;
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => updateNodeInternals(nodeIds));
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [enabled, nodeIds, syncKey, updateNodeInternals]);

  return null;
}

function CodeEvidencePanel({
  node,
  stage,
  inventory,
  sourceFiles,
  jobId,
  width,
  onWidthChange,
  onCollapse,
}: {
  node: SemanticNode;
  stage: ReviewStage;
  inventory: CodeLine[];
  sourceFiles: Map<string, string>;
  jobId?: string;
  width: number;
  onWidthChange(width: number): void;
  onCollapse(): void;
}) {
  const evidenceFiles = useMemo(() => evidenceFilesForNode(node), [node]);
  const [activePath, setActivePath] = useState(evidenceFiles[0]?.path ?? "");
  const mode: CodePanelMode = "full";
  const [rangeIndex, setRangeIndex] = useState(0);
  const [remoteFiles, setRemoteFiles] = useState<Record<string, string>>({});
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const editorApiRef = useRef<Parameters<OnMount>[1] | null>(null);
  const editorLayoutRef = useRef<{ layout(): void } | null>(null);
  const decorationsRef = useRef<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]> | null>(null);

  const activeEvidence = evidenceFiles.find((file) => file.path === activePath) ?? evidenceFiles[0];
  const localContent = activeEvidence ? sourceFiles.get(activeEvidence.path) : undefined;
  const remoteContent = activeEvidence ? remoteFiles[activeEvidence.path] : undefined;

  useEffect(() => {
    if (!activeEvidence || localContent !== undefined || remoteContent !== undefined || !jobId || stage !== "baseline") return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoadingPath(activeEvidence.path);
        setFileError("");
      }
    });
    fetch(`${LOCAL_CODEX_BRIDGE}/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        let payload = await response.json();
        if (!response.ok && response.status === 404) {
          response = await fetch(`${LOCAL_CODEX_BRIDGE}/jobs/latest`, { cache: "no-store", signal: controller.signal });
          payload = await response.json();
        }
        if (!response.ok) throw new Error(payload.error || "Could not load this source file.");
        const snapshotContent = repositoryFilesFromSource(String(payload.source || "")).get(activeEvidence.path);
        if (snapshotContent === undefined) throw new Error("The selected file is not present in the analyzed repository snapshot.");
        setRemoteFiles((current) => ({ ...current, [activeEvidence.path]: snapshotContent }));
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setFileError(error instanceof Error ? error.message : "The complete source file is unavailable for this saved analysis.");
        }
      })
      .finally(() => setLoadingPath((current) => current === activeEvidence.path ? null : current));
    return () => controller.abort();
  }, [activeEvidence, jobId, localContent, remoteContent, stage]);

  const relevantInventory = useMemo(() => {
    if (!activeEvidence) return [];
    const ids = new Set(node.data.lineIds);
    return inventory.filter((line) => line.file.replaceAll("\\", "/") === activeEvidence.path && ids.has(line.id));
  }, [activeEvidence, inventory, node.data.lineIds]);
  const hasCompleteFile = localContent !== undefined || remoteContent !== undefined;
  const baselineContent = localContent ?? remoteContent ?? node.data.sourceCode;
  const beforeContent = formatLines(relevantInventory, "old");
  const afterContent = formatLines(relevantInventory, "new");
  const ranges = useMemo(() => activeEvidence?.ranges ?? [], [activeEvidence]);
  const baselineView = useMemo(() => buildEvidenceEditorView(baselineContent, ranges, "full"), [baselineContent, ranges]);
  const navigationRanges = stage === "baseline" ? baselineView.ranges : ranges;
  const activeRange = navigationRanges[Math.min(rangeIndex, Math.max(0, navigationRanges.length - 1))];

  const refreshEvidenceDecorations = useCallback(() => {
    const editor = editorRef.current;
    const monacoApi = editorApiRef.current;
    if (!editor || !monacoApi || stage !== "baseline") return;
    const lineCount = editor.getModel()?.getLineCount() ?? 1;
    const visibleRanges = navigationRanges
      .filter((range) => range.startLine >= 1 && range.startLine <= lineCount)
      .map((range) => ({ startLine: range.startLine, endLine: Math.min(lineCount, range.endLine) }))
      .filter((range) => range.startLine <= range.endLine);
    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection(visibleRanges.map((range) => ({
      range: new monacoApi.Range(range.startLine, 1, range.endLine, 1),
      options: {
        isWholeLine: true,
        className: "monaco-evidence-line",
        linesDecorationsClassName: "monaco-evidence-gutter",
        overviewRuler: { color: "#6E6ADE", position: monacoApi.editor.OverviewRulerLane.Full },
        minimap: { color: "#6E6ADE", position: monacoApi.editor.MinimapPosition.Inline },
      },
    })));
    if (activeRange && activeRange.startLine <= lineCount) editor.revealLineInCenter(activeRange.startLine);
  }, [activeRange, navigationRanges, stage]);

  const configureEditor = useCallback<OnMount>((editor, monacoApi) => {
    editorRef.current = editor;
    editorApiRef.current = monacoApi;
    editorLayoutRef.current = editor;
    refreshEvidenceDecorations();
  }, [refreshEvidenceDecorations]);

  const configureDiffEditor = useCallback<DiffOnMount>((diffEditor, monacoApi) => {
    const modified = diffEditor.getModifiedEditor();
    editorRef.current = modified;
    editorApiRef.current = monacoApi;
    editorLayoutRef.current = diffEditor;
    modified.revealLineInCenter(1);
  }, []);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        editorLayoutRef.current?.layout();
        refreshEvidenceDecorations();
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [baselineView.content, refreshEvidenceDecorations, width]);

  const navigateRange = (direction: -1 | 1) => {
    if (!navigationRanges.length) return;
    const next = (rangeIndex + direction + navigationRanges.length) % navigationRanges.length;
    setRangeIndex(next);
    editorRef.current?.revealLineInCenter(navigationRanges[next].startLine);
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    let nextWidth = startWidth;
    let resizeFrame = 0;
    handle.classList.add("is-previewing");
    document.documentElement.classList.add("is-resizing-code-panel");

    const preview = () => {
      resizeFrame = 0;
      handle.style.setProperty("--resize-preview-offset", `${startWidth - nextWidth}px`);
    };
    const move = (moveEvent: PointerEvent) => {
      const maximum = Math.max(460, Math.min(920, window.innerWidth - 430));
      nextWidth = Math.min(maximum, Math.max(420, startWidth + startX - moveEvent.clientX));
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(preview);
    };
    const stop = () => {
      if (resizeFrame) {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = 0;
      }
      handle.classList.remove("is-previewing");
      handle.style.removeProperty("--resize-preview-offset");
      document.documentElement.classList.remove("is-resizing-code-panel");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      if (nextWidth !== startWidth) onWidthChange(nextWidth);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    window.addEventListener("blur", stop, { once: true });
  };

  const language = editorLanguageForFile(activeEvidence?.path ?? "");
  return (
    <aside className="code-evidence-panel" aria-label="Code evidence for selected behavior">
      <div className="code-panel-resizer" onPointerDown={beginResize} role="separator" aria-orientation="vertical" aria-label="Resize code evidence panel" />
      <header className="code-panel-header">
        <div>
          <span><i />Code evidence</span>
          <strong>{node.data.title}</strong>
          <small>{node.data.codeIdentity || `${node.data.lineIds.length} attributed source lines`}</small>
        </div>
        <button type="button" className="code-panel-collapse" onClick={onCollapse} aria-label="Collapse code evidence panel" title="Hide code panel"><PanelRightClose aria-hidden="true" /><span>Hide</span></button>
      </header>
      <nav className="code-file-tabs" aria-label="Source files containing this behavior">
        {evidenceFiles.map((file) => (
          <button type="button" key={file.path} className={file.path === activeEvidence?.path ? "active" : ""} onClick={() => { setActivePath(file.path); setFileError(""); setRangeIndex(0); }} title={file.path}>
            <span>{file.path.split("/").pop()}</span><small>{file.ranges.length} range{file.ranges.length === 1 ? "" : "s"}</small>
          </button>
        ))}
      </nav>
      <div className="code-panel-context">
        <div><span>{activeEvidence?.path || "No source file"}</span><strong>{ranges.length ? `${ranges.length} highlighted evidence range${ranges.length === 1 ? "" : "s"}` : "Full source file"}</strong></div>
        {stage === "baseline" ? (
          <div className="full-file-indicator" aria-label="Code visibility">
            <span className="full-file-label"><i />Full file</span>
          </div>
        ) : <span className="diff-mode-label">Before â†’ after</span>}
      </div>
      <div className="code-editor-shell">
        {loadingPath === activeEvidence?.path ? <div className="code-panel-state"><i />Loading source fileâ€¦</div> : null}
        {fileError && !hasCompleteFile ? <div className="code-panel-warning">The complete file is unavailable for this expired analysis. Open the latest dashboard to restore full-file context.</div> : null}
        {stage === "baseline" ? (
          <Editor
            key={`${node.id}-${activeEvidence?.path}-${mode}`}
            height="100%"
            path={activeEvidence?.path}
            value={baselineView.content}
            language={language}
            theme="vs-dark"
            onMount={configureEditor}
            options={{ readOnly: true, automaticLayout: false, fontFamily: "Cascadia Code, Cascadia Mono, Consolas, monospace", fontSize: 14, lineHeight: 23, glyphMargin: true, folding: true, lineNumbers: mode === "relevant" ? (lineNumber) => baselineView.originalLineNumbers?.[lineNumber - 1] ? String(baselineView.originalLineNumbers[lineNumber - 1]) : "â‹¯" : "on", minimap: { enabled: true, maxColumn: 80 }, padding: { top: 18, bottom: 18 }, renderLineHighlight: "none", scrollBeyondLastLine: false, smoothScrolling: true, stickyScroll: { enabled: true }, wordWrap: "off" }}
          />
        ) : (
          <DiffEditor
            key={`${node.id}-${activeEvidence?.path}`}
            height="100%"
            original={beforeContent}
            modified={afterContent}
            language={language}
            theme="vs-dark"
            onMount={configureDiffEditor}
            options={{ readOnly: true, automaticLayout: false, fontFamily: "Cascadia Code, Cascadia Mono, Consolas, monospace", fontSize: 13, lineHeight: 22, minimap: { enabled: false }, renderSideBySide: width >= 680, scrollBeyondLastLine: false, wordWrap: "on" }}
          />
        )}
      </div>
      <footer className="code-panel-footer">
        <span><i />The complete file is shown; highlighted lines are the evidence attributed to this behavior.</span>
        {ranges.length ? <div><button type="button" className="icon-button" onClick={() => navigateRange(-1)} aria-label="Previous highlighted range" title="Previous evidence"><ChevronLeft aria-hidden="true" /></button><strong>{Math.min(rangeIndex + 1, ranges.length)} of {ranges.length}</strong><button type="button" className="icon-button" onClick={() => navigateRange(1)} aria-label="Next highlighted range" title="Next evidence"><ChevronRight aria-hidden="true" /></button></div> : null}
      </footer>
    </aside>
  );
}

function AnalysisActivity({ job, conceptCount, subsystemCount, onCollapse }: { job: AgentJobState | null; conceptCount: number; subsystemCount: number; onCollapse(): void }) {
  if (!job || job.status === "complete") return null;
  if (job.status === "error") {
    return (
      <aside className="analysis-activity activity-error" role="alert">
        <header><span className="activity-error-mark">!</span><div><strong>Analysis stopped</strong><small>The graph kept every completed result.</small></div><button type="button" className="activity-collapse icon-button" onClick={onCollapse} aria-label="Collapse analysis status panel" title="Collapse analysis activity"><PanelBottomClose aria-hidden="true" /></button></header>
        <p>{job.error || "The analysis provider stopped before completing this map."}</p>
        <footer>Return to Repository and run the analysis again. Cached work will be reused.</footer>
      </aside>
    );
  }
  const connecting = job.status === "connecting";
  const analysisProgress = job.total ? job.completed / job.total : 0;
  const connectionProgress = job.connectionGroups ? job.connected / job.connectionGroups : 0;
  const progress = Math.round((connecting ? .86 + connectionProgress * .14 : analysisProgress * .86) * 100);
  const activeSlots = connecting
    ? Math.min(PARALLEL_INTEGRATION_WORKERS, Math.max(0, job.connectionGroups - job.connected))
    : Math.min(PARALLEL_ANALYSIS_WORKERS, Math.max(0, job.total - job.completed));

  return (
    <aside className="analysis-activity" role="status" aria-live="polite" aria-label="Live analysis activity">
      <header>
        <span className="activity-pulse" aria-hidden="true" />
        <div><strong>{connecting ? "Connecting the system map" : "Understanding the repository"}</strong><small>Live · updates as work completes</small></div>
        <b>{progress}%</b>
        <button type="button" className="activity-collapse icon-button" onClick={onCollapse} aria-label="Collapse analysis status panel" title="Collapse analysis activity"><PanelBottomClose aria-hidden="true" /></button>
      </header>
      <div className="activity-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
      <div className="worker-slots" aria-label={`${activeSlots} parallel slots active`}>
        {Array.from({ length: connecting ? PARALLEL_INTEGRATION_WORKERS : PARALLEL_ANALYSIS_WORKERS }, (_, index) => (
          <span key={index} className={index < activeSlots ? "active" : "idle"}><i />Worker {index + 1}</span>
        ))}
      </div>
      <ol className="activity-log">
        <li className="done"><span>Repository divided</span><strong>{job.total} file-aware work units</strong></li>
        <li className={job.completed ? "done" : "active"}><span>Semantic mapping</span><strong>{job.completed}/{job.total} complete · up to {activeSlots} active</strong></li>
        <li className={conceptCount ? "done" : "waiting"}><span>Visible understanding</span><strong>{conceptCount} behaviors · {subsystemCount} subsystems</strong></li>
        <li className={connecting ? "active" : "waiting"}><span>Cross-file connections</span><strong>{connecting ? `${job.connected}/${job.connectionGroups} groups connected` : "Starts after file mapping"}</strong></li>
      </ol>
      {job.cached ? <footer>{job.cached} cached result{job.cached === 1 ? "" : "s"} reused</footer> : <footer>First results can take a few minutes; completed units appear immediately.</footer>}
    </aside>
  );
}

const nodeTypes = { semantic: SemanticNodeView, subsystem: StructureNodeView, fileContainer: FileContainerView, journeyStage: JourneyStageView };
const edgeTypes = { graph: GraphEdge };

export default function Home() {
  const [stage, setStage] = useState<ReviewStage>("baseline");
  const [graphMode, setGraphMode] = useState<GraphMode>("structure");
  const [source, setSource] = useState(SAMPLE_SOURCE);
  const [diff, setDiff] = useState(SAMPLE_DIFF);
  const [task, setTask] = useState("Add a resilient pricing fallback for provider timeouts.");
  const [provider, setProvider] = useState<ProviderId>("codex-local");
  const [providerHealth, setProviderHealth] = useState<ProviderHealth>("idle");
  const [demoMode, setDemoMode] = useState(true);
  const [baseline, setBaseline] = useState<AnalysisResult>(() => buildDemoGraph("baseline", SAMPLE_SOURCE));
  const [change, setChange] = useState<AnalysisResult>(() => buildDemoGraph("change", SAMPLE_DIFF));
  const [baselineReady, setBaselineReady] = useState(true);
  const [selectedId, setSelectedId] = useState("flow");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("input");
  const [compact, setCompact] = useState(false);
  const [zoomMode, setZoomMode] = useState<GraphZoomMode>("standard");
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("complete");
  const [progressStep, setProgressStep] = useState(3);
  const [message, setMessage] = useState("Existing code mapped. Select a concept to inspect its exact source.");
  const [repository, setRepository] = useState<{ name: string; files: number } | null>(null);
  const [agentJob, setAgentJob] = useState<AgentJobState | null>(null);
  const [journeyOrderPlan, setJourneyOrderPlan] = useState<JourneyOrderPlan | null>(null);
  const [journeyOrderStatus, setJourneyOrderStatus] = useState<"idle" | "ordering" | "ready" | "error">("idle");
  const [journeyStagePlans, setJourneyStagePlans] = useState<Record<string, JourneyStagePlan>>({});
  const [journeyStageStatus, setJourneyStageStatus] = useState<Record<string, "ordering" | "ready" | "error">>({});
  const [activeSubsystem, setActiveSubsystem] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedDependencyEdgeId, setSelectedDependencyEdgeId] = useState<string | null>(null);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());
  const [codePanelOpen, setCodePanelOpen] = useState(false);
  const [codePanelWidth, setCodePanelWidth] = useState(560);
  const [activityPanelOpen, setActivityPanelOpen] = useState(true);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const graphInstanceRef = useRef<ReactFlowInstance | null>(null);
  const previousViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const previousFocusRef = useRef<string | null>(null);
  const autoFitKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1040px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (!jobId) return;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        let response = await fetch(`${LOCAL_CODEX_BRIDGE}/jobs/${jobId}`, { cache: "no-store" });
        let job = await response.json();
        if (!response.ok && response.status === 404) {
          response = await fetch(`${LOCAL_CODEX_BRIDGE}/jobs/latest`, { cache: "no-store" });
          job = await response.json();
          if (response.ok && job.id) {
            const recoveredUrl = new URL(window.location.href);
            recoveredUrl.searchParams.set("job", job.id);
            window.history.replaceState({}, "", recoveredUrl);
          }
        }
        if (!response.ok) throw new Error(job.error ?? "Agent analysis job was not found.");
        if (cancelled) return;

        const nextStage: ReviewStage = job.mode === "change" ? "change" : "baseline";
        const nextSource = String(job.source || "");
        const final = job.status === "complete";
        const result = materializeAiGraph(nextStage, nextSource, job.analysis ?? { nodes: [], edges: [] }, String(job.provider || "Agent integration"), final);
        setAgentJob({
          id: job.id,
          status: job.status,
          total: job.total,
          completed: job.completed,
          cached: job.cached,
          connected: job.connected,
          connectionGroups: job.connectionGroups,
          error: job.error,
        });
        setStage(nextStage);
        setDemoMode(false);
        setProvider(String(job.provider).startsWith("OpenAI API") ? "openai-api" : "codex-local");
        if (nextStage === "baseline") {
          setSource(nextSource);
          setBaseline(result);
          setBaselineReady(final);
        } else {
          setDiff(nextSource);
          setChange(result);
          setBaselineReady(true);
        }
        if (job.repository) setRepository({ name: job.repository.name || "Agent workspace", files: job.repository.files || 0 });
        setSelectedId((current) => result.nodes.some((node) => node.id === current) ? current : result.nodes[0]?.id ?? "");
        setMobilePanel("graph");
        setStatus(job.status === "error" ? "error" : final ? "complete" : "running");
        setProgressStep(job.status === "connecting" ? 2 : final ? 3 : 1);
        setMessage(job.status === "error"
          ? job.error || "Agent analysis failed."
          : job.status === "connecting"
            ? `The map is usable · connecting concept group ${job.connected} of ${job.connectionGroups}.`
            : final
              ? `${result.classified}/${result.inventory.length} lines mapped by the agent workflow · ${job.cached} cached results reused.`
              : `Agents mapped ${job.completed} of ${job.total} file-aware work units in parallel.`);

        if (!final && job.status !== "error") timer = window.setTimeout(poll, 700);
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Could not read the agent analysis job.");
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const checkProviderHealth = useCallback(async () => {
    if (provider !== "codex-local" || demoMode) {
      setProviderHealth("idle");
      return true;
    }
    setProviderHealth("checking");
    const ready = await localBridgeIsReady();
    setProviderHealth(ready ? "ready" : "offline");
    return ready;
  }, [demoMode, provider]);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkProviderHealth(), 0);
    return () => window.clearTimeout(timer);
  }, [checkProviderHealth]);

  const analysis = stage === "baseline" ? baseline : change;
  const selectedNode = useMemo(
    () => analysis.nodes.find((node) => node.id === selectedId) ?? analysis.nodes[0],
    [analysis, selectedId],
  );
  const sourceFiles = useMemo(() => repositoryFilesFromSource(analysis.source), [analysis.source]);
  const subsystemGroups = useMemo(() => buildSubsystemGroups(analysis.nodes), [analysis.nodes]);
  const behaviorOwnership = useMemo(() => buildBehaviorOwnership(subsystemGroups), [subsystemGroups]);
  const selectedSubsystem = useMemo(
    () => subsystemGroups.find((group) => group.id === activeSubsystem) ?? null,
    [activeSubsystem, subsystemGroups],
  );
  const selectedModule = useMemo(
    () => selectedSubsystem?.modules.find((group) => group.id === activeModule) ?? null,
    [activeModule, selectedSubsystem],
  );
  const selectedFile = useMemo(
    () => selectedModule?.files.find((group) => group.id === activeFile) ?? null,
    [activeFile, selectedModule],
  );
  const orderedFileBehaviors = useMemo(() => {
    if (!selectedFile) return [];
    const ids = new Set(selectedFile.nodes.map((node) => node.id));
    const internalEdges = analysis.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    return rankBehaviorGraph(selectedFile.nodes, internalEdges).flat();
  }, [analysis.edges, selectedFile]);
  const activeFileBehaviorIndex = useMemo(
    () => orderedFileBehaviors.findIndex((node) => node.id === focusedNodeId),
    [focusedNodeId, orderedFileBehaviors],
  );
  const discoveredSystemJourneys = useMemo(
    () => buildSystemJourneys(analysis, behaviorOwnership),
    [analysis, behaviorOwnership],
  );
  const orderingContext = useMemo(
    () => journeyOrderingContext(discoveredSystemJourneys, analysis, behaviorOwnership),
    [analysis, behaviorOwnership, discoveredSystemJourneys],
  );
  useEffect(() => {
    if (graphMode !== "behavior" || demoMode || status !== "complete" || discoveredSystemJourneys.length < 2) return;
    let cancelled = false;
    const controller = new AbortController();
    const orderJourneys = async () => {
      setJourneyOrderStatus("ordering");
      setJourneyOrderPlan(null);
      setJourneyStagePlans({});
      setJourneyStageStatus({});
      try {
        const cacheKey = await digestText(JSON.stringify({ version: JOURNEY_ORDERING_VERSION, kind: "journeys", provider, orderingContext }));
        let ordering = await readCachedValue<JourneyOrderPlan>(cacheKey);
        if (!ordering) {
          const endpoint = provider === "codex-local" ? `${LOCAL_CODEX_BRIDGE}/analyze` : "/api/analyze";
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "order", orderingKind: "journeys", provider, journeys: orderingContext }),
            signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Journey ordering failed.");
          ordering = payload.ordering;
          await writeCachedValue(cacheKey, ordering);
        }
        if (cancelled) return;
        setJourneyOrderPlan(validateJourneyOrderPlan(ordering, discoveredSystemJourneys));
        setJourneyOrderStatus("ready");
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setJourneyOrderPlan(validateJourneyOrderPlan(null, discoveredSystemJourneys));
        setJourneyOrderStatus("error");
      }
    };
    void orderJourneys();
    return () => { cancelled = true; controller.abort(); };
  }, [demoMode, discoveredSystemJourneys, graphMode, orderingContext, provider, status]);
  const systemJourneys = useMemo(
    () => orderedJourneysFromPlan(discoveredSystemJourneys, journeyOrderPlan),
    [discoveredSystemJourneys, journeyOrderPlan],
  );
  const journeyOrderById = useMemo(
    () => new Map((journeyOrderPlan?.journeys ?? []).map((item) => [item.journeyId, item])),
    [journeyOrderPlan],
  );
  const systemJourneyGroups = useMemo(
    () => JOURNEY_PHASE_ORDER.map((phase) => ({
      phase,
      journeys: systemJourneys.filter((journey) => (journeyOrderById.get(journey.id)?.phase ?? defaultJourneyPhase(journey)) === phase),
    })).filter((group) => group.journeys.length),
    [journeyOrderById, systemJourneys],
  );
  const activeSystemJourney = useMemo(
    () => systemJourneys.find((journey) => journey.anchorId === focusedNodeId) ?? null,
    [focusedNodeId, systemJourneys],
  );
  const activeSystemJourneyIndex = useMemo(
    () => systemJourneys.findIndex((journey) => journey.id === activeSystemJourney?.id),
    [activeSystemJourney?.id, systemJourneys],
  );
  const activeJourneyStagePlan = useMemo(
    () => activeSystemJourney ? journeyStagePlans[activeSystemJourney.id] ?? fallbackJourneyStagePlan(activeSystemJourney, analysis) : undefined,
    [activeSystemJourney, analysis, journeyStagePlans],
  );
  const activeJourneySteps = useMemo(
    () => [...(activeJourneyStagePlan?.steps ?? [])].sort((left, right) => left.sequence - right.sequence),
    [activeJourneyStagePlan],
  );
  const activeJourneyStepIndex = useMemo(
    () => activeJourneySteps.findIndex((step) => step.nodeId === selectedId),
    [activeJourneySteps, selectedId],
  );
  useEffect(() => {
    if (!activeSystemJourney || demoMode || status !== "complete" || journeyStagePlans[activeSystemJourney.id]) return;
    let cancelled = false;
    const controller = new AbortController();
    const orderStages = async () => {
      setJourneyStageStatus((current) => ({ ...current, [activeSystemJourney.id]: "ordering" }));
      const context = journeyStageContext(activeSystemJourney, analysis, behaviorOwnership);
      try {
        const cacheKey = await digestText(JSON.stringify({ version: JOURNEY_ORDERING_VERSION, kind: "stages", provider, context }));
        let ordering = await readCachedValue<JourneyStagePlan>(cacheKey);
        if (!ordering) {
          const endpoint = provider === "codex-local" ? `${LOCAL_CODEX_BRIDGE}/analyze` : "/api/analyze";
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "order", orderingKind: "stages", provider, ...context }),
            signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Journey stage ordering failed.");
          ordering = payload.ordering;
          await writeCachedValue(cacheKey, ordering);
        }
        if (cancelled) return;
        setJourneyStagePlans((current) => ({ ...current, [activeSystemJourney.id]: validateJourneyStagePlan(ordering, activeSystemJourney, analysis) }));
        setJourneyStageStatus((current) => ({ ...current, [activeSystemJourney.id]: "ready" }));
        autoFitKeyRef.current = null;
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setJourneyStagePlans((current) => ({ ...current, [activeSystemJourney.id]: fallbackJourneyStagePlan(activeSystemJourney, analysis) }));
        setJourneyStageStatus((current) => ({ ...current, [activeSystemJourney.id]: "error" }));
      }
    };
    void orderStages();
    return () => { cancelled = true; controller.abort(); };
  }, [activeSystemJourney, analysis, behaviorOwnership, demoMode, journeyStagePlans, provider, status]);
  const visibleGraph = useMemo(
    () => graphMode === "behavior"
      ? layoutSystemBehaviorGraph(analysis, behaviorOwnership, focusedNodeId, activeSystemJourney?.nodeIds, activeJourneyStagePlan, selectedId)
      : layoutExpandedGraph(repository?.name ?? "Current repository", analysis, subsystemGroups, selectedSubsystem, selectedModule, selectedFile, focusedNodeId),
    [activeJourneyStagePlan, activeSystemJourney?.nodeIds, analysis, behaviorOwnership, focusedNodeId, graphMode, repository?.name, selectedFile, selectedId, selectedModule, selectedSubsystem, subsystemGroups],
  );
  const toggleNodeCollapsed = useCallback((nodeId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);
  const visibleNodeIds = useMemo(() => visibleGraph.nodes.map((node) => node.id), [visibleGraph.nodes]);
  const orderedVisibleNodes = useMemo(
    () => visibleGraph.nodes
      .filter((node) => graphMode === "behavior" || !selectedFile || node.type === "semantic")
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id)),
    [graphMode, selectedFile, visibleGraph.nodes],
  );
  const focusedNodeIndex = useMemo(
    () => orderedVisibleNodes.findIndex((node) => node.id === focusedNodeId),
    [focusedNodeId, orderedVisibleNodes],
  );
  const renderedNodes = useMemo(
    () => visibleGraph.nodes.map((node) => {
      if (node.type !== "semantic") return {
        ...node,
        selected: node.id === focusedNodeId,
      };
      const semanticId = node.data.semanticId || node.id;
      return {
        ...node,
        data: {
          ...node.data,
          collapsed: collapsedNodeIds.has(semanticId),
          onToggleCollapsed: toggleNodeCollapsed,
        },
        selected: graphMode === "behavior" ? semanticId === selectedId : node.id === focusedNodeId,
      };
    }),
    [collapsedNodeIds, focusedNodeId, graphMode, selectedId, toggleNodeCollapsed, visibleGraph.nodes],
  );
  useEffect(() => {
    const instance = graphInstanceRef.current;
    if (!instance) return;
    const targetId = activeFile ?? activeModule ?? activeSubsystem ?? "structure-root-system";
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (graphMode === "behavior") {
          void instance.fitView({ padding: .16, minZoom: .08, maxZoom: .72, duration: 560 });
          return;
        }
        if (!activeFile) {
          void instance.fitView({ padding: .14, minZoom: .06, maxZoom: .82, duration: 520 });
          return;
        }
        const target = instance.getNode(targetId);
        if (!target) return;
        const expandedFile = target.type === "fileContainer";
        const centerX = target.position.x + (expandedFile ? 520 : 220);
        const centerY = target.position.y + (expandedFile ? 330 : 100);
        void instance.setCenter(centerX, centerY, { zoom: expandedFile ? .72 : .82, duration: 520 });
      });
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [activeFile, activeModule, activeSubsystem, graphMode]);
  useEffect(() => {
    const instance = graphInstanceRef.current;
    if (!instance) return;
    if (!focusedNodeId) {
      if (graphMode === "structure" && previousFocusRef.current && previousViewportRef.current) void instance.setViewport(previousViewportRef.current, { duration: 420 });
      previousFocusRef.current = null;
      previousViewportRef.current = null;
      autoFitKeyRef.current = null;
      return;
    }
    if (!previousFocusRef.current) previousViewportRef.current = instance.getViewport();
    previousFocusRef.current = focusedNodeId;
    const autoFitKey = `${graphMode}:${focusedNodeId}`;
    if (autoFitKeyRef.current === autoFitKey) return;
    const relatedIds = new Set<string>([focusedNodeId]);
    visibleGraph.edges.forEach((edge) => {
      if ((edge.data as DependencyEdgeData | undefined)?.dependency) {
        relatedIds.add(edge.source);
        relatedIds.add(edge.target);
      }
    });
    const relatedNodes = visibleGraph.nodes.filter((node) => relatedIds.has(node.id));
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        autoFitKeyRef.current = autoFitKey;
        if (relatedNodes.length > 1) void instance.fitView({ nodes: relatedNodes, padding: .18, minZoom: .5, maxZoom: .9, duration: 520 });
        else {
          const node = relatedNodes[0];
          if (node) void instance.setCenter(node.position.x + 220, node.position.y + 100, { zoom: Math.min(.9, instance.getZoom()), duration: 420 });
        }
      });
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [focusedNodeId, graphMode, visibleGraph.edges, visibleGraph.nodes]);
  useEffect(() => {
    if (!codePanelOpen) return;
    const timer = window.setTimeout(() => {
      const instance = graphInstanceRef.current;
      if (!instance) return;
      const visibleNode = visibleGraph.nodes.find((node) => node.id === selectedId || (node.type === "semantic" && node.data.semanticId === selectedId));
      if (!visibleNode) return;
      const node = instance.getNode(visibleNode.id) ?? visibleNode;
      const nodeWidth = node.measured?.width ?? BEHAVIOR_CARD_WIDTH;
      const nodeHeight = node.measured?.height ?? 260;
      void instance.setCenter(node.position.x + nodeWidth / 2, node.position.y + nodeHeight / 2, { zoom: Math.min(.86, Math.max(.46, instance.getZoom())), duration: 360 });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [codePanelOpen, selectedId, visibleGraph.nodes]);
  const selectedDependency = useMemo(() => {
    const edge = visibleGraph.edges.find((candidate) => candidate.id === selectedDependencyEdgeId);
    const data = (edge?.data ?? {}) as DependencyEdgeData;
    if (!edge || !data.dependency) return null;
    const visibleById = new Map(visibleGraph.nodes.map((node) => [node.id, node]));
    const semanticById = new Map(analysis.nodes.map((node) => [node.id, node]));
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceTitle: visibleById.get(edge.source)?.data.title ?? edge.source,
      targetTitle: visibleById.get(edge.target)?.data.title ?? edge.target,
      count: data.count ?? data.members?.length ?? 0,
      scope: data.dependencyScope ?? "cross-file",
      primaryLabel: data.primaryLabel ?? String(edge.label || "Dependency"),
      members: (data.members ?? []).map((member) => {
        const source = semanticById.get(member.source);
        const target = semanticById.get(member.target);
        return {
          ...member,
          sourceTitle: source?.data.codeIdentity || source?.data.title || member.source,
          targetTitle: target?.data.codeIdentity || target?.data.title || member.target,
          sourceFile: source ? primaryFileForNode(source) : "Unknown source",
          targetFile: target ? primaryFileForNode(target) : "Unknown target",
          plainLabel: plainDependencyLabel(member.label, target),
        };
      }),
    };
  }, [analysis.nodes, selectedDependencyEdgeId, visibleGraph.edges, visibleGraph.nodes]);
  const dependencyNavigationEdges = useMemo(
    () => visibleGraph.edges.filter((edge) => Boolean((edge.data as DependencyEdgeData | undefined)?.dependency)),
    [visibleGraph.edges],
  );
  const selectedDependencyIndex = useMemo(
    () => dependencyNavigationEdges.findIndex((edge) => edge.id === selectedDependencyEdgeId),
    [dependencyNavigationEdges, selectedDependencyEdgeId],
  );
  const visibleEdges = useMemo(() => {
    const hasExplicitEdge = Boolean(hoveredEdgeId || selectedDependencyEdgeId);
    return visibleGraph.edges.map((edge) => {
      const dependency = Boolean((edge.data as DependencyEdgeData | undefined)?.dependency);
      const active = edge.id === hoveredEdgeId || edge.id === selectedDependencyEdgeId;
      const dimmed = hasExplicitEdge ? !active : Boolean(focusedNodeId && !dependency);
      return {
        ...edge,
        data: { ...(edge.data ?? {}), active, dimmed, showLabel: active },
        style: { ...edge.style, opacity: dimmed ? .08 : active ? 1 : dependency ? .72 : .84, strokeWidth: active ? 3.4 : dependency ? 2.5 : 2.1 },
      };
    });
  }, [focusedNodeId, hoveredEdgeId, selectedDependencyEdgeId, visibleGraph.edges]);

  const openSubsystem = useCallback((subsystemId: string | null) => {
    setActiveSubsystem(subsystemId);
    setActiveModule(null);
    setActiveFile(null);
    setFocusedNodeId(null);
    setSelectedDependencyEdgeId(null);
  }, []);
  const openModule = useCallback((moduleId: string) => {
    setActiveModule(moduleId);
    setActiveFile(null);
    setFocusedNodeId(null);
    setSelectedDependencyEdgeId(null);
  }, []);
  const openFile = useCallback((fileId: string) => {
    setActiveFile(fileId);
    setSelectedDependencyEdgeId(null);
    const file = selectedModule?.files.find((candidate) => candidate.id === fileId);
    if (!file) return;
    const ids = new Set(file.nodes.map((node) => node.id));
    const internalEdges = analysis.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    const first = rankBehaviorGraph(file.nodes, internalEdges).flat()[0] ?? file.nodes[0];
    if (first) {
      setFocusedNodeId(first.id);
      setSelectedId(first.id);
    }
  }, [analysis.edges, selectedModule]);

  const selectFileBehavior = useCallback((behaviorId: string) => {
    if (!orderedFileBehaviors.some((node) => node.id === behaviorId)) return;
    setFocusedNodeId(behaviorId);
    setSelectedId(behaviorId);
    setSelectedDependencyEdgeId(null);
    setCodePanelOpen(true);
  }, [orderedFileBehaviors]);

  const navigateFileBehavior = useCallback((direction: -1 | 1) => {
    if (!orderedFileBehaviors.length) return;
    const current = activeFileBehaviorIndex < 0 ? 0 : activeFileBehaviorIndex;
    const next = current + direction;
    if (next < 0 || next >= orderedFileBehaviors.length) return;
    selectFileBehavior(orderedFileBehaviors[next].id);
  }, [activeFileBehaviorIndex, orderedFileBehaviors, selectFileBehavior]);

  const selectSystemJourney = useCallback((journeyId: string, selectedBehaviorId?: string) => {
    const journey = systemJourneys.find((candidate) => candidate.id === journeyId);
    if (!journey) return;
    setFocusedNodeId(journey.anchorId);
    setSelectedId(selectedBehaviorId && journey.nodeIds.includes(selectedBehaviorId) ? selectedBehaviorId : journey.anchorId);
    setSelectedDependencyEdgeId(null);
  }, [systemJourneys]);

  const selectSystemBehavior = useCallback((behaviorId: string) => {
    setCodePanelOpen(true);
    if (activeSystemJourney?.nodeIds.includes(behaviorId)) {
      setSelectedId(behaviorId);
      setSelectedDependencyEdgeId(null);
      return;
    }
    const journey = systemJourneys
      .filter((candidate) => candidate.nodeIds.includes(behaviorId))
      .sort((left, right) => left.nodeIds.length - right.nodeIds.length)[0];
    if (journey) selectSystemJourney(journey.id, behaviorId);
  }, [activeSystemJourney?.nodeIds, selectSystemJourney, systemJourneys]);

  const navigateSystemBehavior = useCallback((direction: -1 | 1) => {
    if (!systemJourneys.length) return;
    const current = activeSystemJourneyIndex < 0 ? (direction > 0 ? -1 : 0) : activeSystemJourneyIndex;
    const next = current + direction;
    if (next < 0 || next >= systemJourneys.length) return;
    selectSystemJourney(systemJourneys[next].id);
  }, [activeSystemJourneyIndex, selectSystemJourney, systemJourneys]);

  const navigateJourneyStep = useCallback((direction: -1 | 1) => {
    if (!activeJourneySteps.length) return;
    const current = activeJourneyStepIndex < 0 ? (direction > 0 ? -1 : 0) : activeJourneyStepIndex;
    const next = current + direction;
    if (next < 0 || next >= activeJourneySteps.length) return;
    const step = activeJourneySteps[next];
    setSelectedId(step.nodeId);
    setSelectedDependencyEdgeId(null);
    setCodePanelOpen(true);
    const instance = graphInstanceRef.current;
    const node = instance?.getNode(step.nodeId);
    if (node) {
      const width = node.measured?.width ?? BEHAVIOR_CARD_WIDTH;
      const height = node.measured?.height ?? 320;
      void instance?.setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: Math.max(.62, Math.min(.9, instance.getZoom())), duration: 420 });
    }
  }, [activeJourneyStepIndex, activeJourneySteps]);

  const chooseGraphMode = useCallback((next: GraphMode) => {
    setGraphMode(next);
    setSelectedDependencyEdgeId(null);
    setHoveredEdgeId(null);
    previousFocusRef.current = null;
    previousViewportRef.current = null;
    autoFitKeyRef.current = null;
    if (next === "behavior") {
      setFocusedNodeId(null);
      return;
    }
    const first = orderedFileBehaviors[0];
    setFocusedNodeId(first?.id ?? null);
    if (first) setSelectedId(first.id);
  }, [orderedFileBehaviors]);

  const focusVisibleNode = useCallback((index: number) => {
    const node = orderedVisibleNodes[index];
    if (!node) return;
    setFocusedNodeId(node.id);
    if (node.type === "semantic") setSelectedId(node.id);

    const instance = graphInstanceRef.current;
    const measured = instance?.getNode(node.id)?.measured;
    const width = measured?.width ?? 440;
    const height = measured?.height ?? 180;
    const zoom = instance?.getZoom() ?? (compact ? .68 : .82);
    void instance?.setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom, duration: 360 });
  }, [compact, orderedVisibleNodes]);

  const navigateFocusedNode = useCallback((direction: -1 | 1) => {
    const nextIndex = focusedNodeIndex < 0 ? 0 : focusedNodeIndex + direction;
    if (nextIndex < 0 || nextIndex >= orderedVisibleNodes.length) return;
    focusVisibleNode(nextIndex);
  }, [focusVisibleNode, focusedNodeIndex, orderedVisibleNodes.length]);

  const navigateDependency = useCallback((direction: -1 | 1) => {
    if (!dependencyNavigationEdges.length) return;
    const current = selectedDependencyIndex < 0 ? (direction > 0 ? -1 : 0) : selectedDependencyIndex;
    const nextIndex = (current + direction + dependencyNavigationEdges.length) % dependencyNavigationEdges.length;
    const edge = dependencyNavigationEdges[nextIndex];
    setSelectedDependencyEdgeId(edge.id);
    const instance = graphInstanceRef.current;
    const endpointNodes = [instance?.getNode(edge.source), instance?.getNode(edge.target)].filter((node): node is Node => Boolean(node));
    if (endpointNodes.length) void instance?.fitView({ nodes: endpointNodes, padding: .3, maxZoom: .9, duration: 480 });
  }, [dependencyNavigationEdges, selectedDependencyIndex]);

  const fitWholeGraph = useCallback(() => {
    void graphInstanceRef.current?.fitView({ padding: .12, minZoom: .06, maxZoom: .82, duration: 620 });
  }, []);

  const chooseStage = useCallback((next: ReviewStage) => {
    if (next === "change" && !baselineReady) return;
    setStage(next);
    setActiveSubsystem(null);
    setActiveModule(null);
    setActiveFile(null);
    const nextAnalysis = next === "baseline" ? baseline : change;
    setSelectedId(nextAnalysis.nodes.find((node) => node.id === (next === "baseline" ? "flow" : "routing"))?.id ?? nextAnalysis.nodes[0]?.id ?? "");
    setMobilePanel("graph");
    setMessage(next === "baseline" ? "Existing code map ready." : "Change overlay ready. Existing-code context is preserved.");
  }, [baseline, baselineReady, change]);

  const runAnalysis = useCallback(async () => {
    const content = stage === "baseline" ? source : diff;
    const inventory = stage === "baseline" ? parseSource(source) : parseDiff(diff);
    if (!content.trim() || inventory.length === 0) {
      setStatus("error");
      setMessage(stage === "baseline" ? "Add source code before building the baseline map." : "Add a unified diff before reviewing the change.");
      return;
    }

    setStatus("running");
    setProgressStep(1);
    setMessage(stage === "baseline" ? "Building the existing-code map…" : "Layering the change over the baseline…");

    try {
      let result: AnalysisResult;
      if (demoMode) {
        await new Promise((resolve) => setTimeout(resolve, 420));
        setProgressStep(2);
        result = buildDemoGraph(stage, content, provider === "codex-local" ? "Codex local · demo" : "OpenAI API · demo");
      } else {
        if (provider === "codex-local" && !(await checkProviderHealth())) {
          throw new Error("Local Codex is offline. In a terminal for this project, run: npm run codex:bridge — then retry.");
        }
        const endpoint = provider === "codex-local" ? `${LOCAL_CODEX_BRIDGE}/analyze` : "/api/analyze";
        const batches = buildAnalysisBatches(inventory);
        const analyses: Array<AiAnalysis | undefined> = new Array(batches.length);
        let providerName = provider;
        let completed = 0;
        let cacheHits = 0;

        await runParallel(batches, PARALLEL_ANALYSIS_WORKERS, async (batch, index) => {
          const cacheKey = await digestText(JSON.stringify({ prompt: PROMPT_VERSION, provider, stage, task: stage === "baseline" ? "" : task, batch }));
          let batchAnalysis: AiAnalysis | undefined = (await readCachedAnalysis(cacheKey)) ?? undefined;
          if (batchAnalysis) {
            cacheHits += 1;
          } else {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "analyze",
                provider,
                mode: stage,
                source: stage === "baseline" ? batch.content : undefined,
                diff: stage === "change" ? batch.content : undefined,
                task,
                inventory: batch.inventory,
                baselineContext: stage === "change"
                  ? baseline.nodes.slice(0, 160).map((node) => ({ id: node.id, title: node.data.title, kind: node.data.kind, summary: node.data.summary }))
                  : undefined,
              }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? `Analysis work unit ${index + 1} failed.`);
            if (!payload.analysis) throw new Error(`Analysis work unit ${index + 1} returned no semantic analysis.`);
            batchAnalysis = payload.analysis as AiAnalysis;
            providerName = payload.provider ?? providerName;
            await writeCachedAnalysis(cacheKey, batchAnalysis);
          }

          analyses[index] = batchAnalysis;
          completed += 1;
          const partial = materializeAiGraph(
            stage,
            content,
            mergeAiAnalyses(analyses),
            `${providerName} - ${completed}/${batches.length} work units`,
            false,
          );
          if (stage === "baseline") setBaseline(partial);
          else setChange(partial);
          if (completed === 1) setMobilePanel("graph");
          setMessage(`Mapped ${completed} of ${batches.length} file-aware work units with ${PARALLEL_ANALYSIS_WORKERS} parallel workers${cacheHits ? ` · ${cacheHits} from cache` : ""}.`);
        });

        let merged = mergeAiAnalyses(analyses);
        const integrationWindows = buildIntegrationWindows(merged.nodes);
        if (integrationWindows.length) {
          setProgressStep(2);
          let connected = 0;
          const crossEdges: AiAnalysis["edges"] = [];
          await runParallel(integrationWindows, PARALLEL_INTEGRATION_WORKERS, async (nodes, index) => {
            const compactNodes = integrationNodeContext(nodes, inventory);
            const cacheKey = await digestText(JSON.stringify({ prompt: `${PROMPT_VERSION}-connect`, provider, compactNodes }));
            let connectionAnalysis = await readCachedAnalysis(cacheKey);
            if (!connectionAnalysis) {
              const response = await fetch(endpoint, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "integrate", provider, mode: stage, nodes: compactNodes }),
              });
              const payload = await response.json();
              if (!response.ok) throw new Error(payload.error ?? `Concept connection pass ${index + 1} failed.`);
              connectionAnalysis = { nodes: [], edges: payload.analysis?.edges ?? [] };
              providerName = payload.provider ?? providerName;
              await writeCachedAnalysis(cacheKey, connectionAnalysis);
            }
            crossEdges.push(...connectionAnalysis.edges);
            connected += 1;
            const partialMerged = mergeEdges(merged, crossEdges);
            const partial = materializeAiGraph(stage, content, partialMerged, `${providerName} - connecting concepts`, false);
            if (stage === "baseline") setBaseline(partial);
            else setChange(partial);
            setMessage(`Source map is usable now · connecting concept group ${connected} of ${integrationWindows.length}.`);
          });
          merged = mergeEdges(merged, crossEdges);
        }

        result = materializeAiGraph(
          stage,
          content,
          merged,
          `${providerName} - ${batches.length} file-aware work unit${batches.length === 1 ? "" : "s"}`,
        );
      }

      if (stage === "baseline") {
        setBaseline(result);
        setBaselineReady(true);
        setSelectedId(result.nodes.find((node) => node.data.kind === "flow")?.id ?? result.nodes[0]?.id ?? "");
        setMessage(`${result.classified}/${result.inventory.length} source lines classified. The baseline is ready for change review.`);
      } else {
        setChange(result);
        setSelectedId(result.nodes.find((node) => node.data.kind === "routing")?.id ?? result.nodes[0]?.id ?? "");
        setMessage(`${result.classified}/${result.inventory.length} changed lines classified against the existing-code baseline.`);
      }
      setStatus("complete");
      setProgressStep(3);
      setMobilePanel("graph");
    } catch (error) {
      setStatus("error");
      const rawMessage = error instanceof Error ? error.message : "Analysis failed.";
      setMessage(rawMessage === "Failed to fetch"
        ? "The analysis service could not be reached. For local Codex, run: npm run codex:bridge — then retry."
        : rawMessage);
    }
  }, [baseline.nodes, checkProviderHealth, demoMode, diff, provider, source, stage, task]);

  const importRepositoryFiles = useCallback(async (files: ImportedFile[], name: string) => {
    setStatus("running");
    setProgressStep(0);
    setMessage("Reading code files from the selected repository…");
    const snapshot = await buildRepositorySnapshot(files);
    if (!snapshot.source.trim()) {
      setStatus("error");
      setMessage("No supported text or code files were found in that folder.");
      return;
    }
    setSource(snapshot.source);
    setRepository({ name, files: snapshot.included });
    setDemoMode(false);
    setBaselineReady(false);
    setStatus("idle");
    setProgressStep(3);
    setMessage(`${snapshot.included} repository files loaded. Build the baseline map when ready.`);
  }, []);

  const chooseRepository = useCallback(async () => {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandleLike> }).showDirectoryPicker;
    if (!picker) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const directory = await picker();
      await importRepositoryFiles(await collectDirectoryFiles(directory), directory.name);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStatus("error");
        setMessage("The repository folder could not be read. You can still paste source code below.");
      }
    }
  }, [importRepositoryFiles]);

  const handleFolderFallback = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    const imported = files.map((file) => ({ path: file.webkitRelativePath || file.name, file }));
    const name = imported[0]?.path.split("/")[0] || "Local repository";
    await importRepositoryFiles(imported, name);
    event.target.value = "";
  }, [importRepositoryFiles]);

  const graphTitle = stage === "baseline" ? "How the existing code works" : "What the change does to that system";
  const graphSubtitle = stage === "baseline"
    ? "Responsibilities, request flow, decisions, outputs, configuration, and evidence."
    : "Every changed line is attached to an exact before-to-after behavior.";
  const focusedSystemNode = graphMode === "behavior" && focusedNodeId ? analysis.nodes.find((node) => node.id === focusedNodeId) : null;
  const hierarchyLabel = graphMode === "behavior" ? "System behavior HLD" : selectedFile ? "File behaviors" : selectedModule ? "Module files" : selectedSubsystem ? "Subsystem modules" : stage === "baseline" ? "System overview" : "Change overview";
  const hierarchyTitle = graphMode === "behavior" ? activeSystemJourney?.title ?? "End-to-end system journeys" : selectedFile?.title ?? selectedModule?.title ?? selectedSubsystem?.title ?? graphTitle;
  const hierarchyDescription = graphMode === "behavior"
    ? activeSystemJourney
      ? `${activeSystemJourney.description}. Connected steps stay together while you inspect individual tiles.`
      : `${systemJourneys.length} distinct end-to-end journeys grouped from ${analysis.nodes.length} mapped behaviors. The project explorer still contains every behavior.`
    : selectedFile
      ? `${selectedFile.nodes.length} behaviors owned by ${selectedFile.path}. Select one for exact code evidence.`
      : selectedModule
        ? `${selectedModule.files.length} files in ${selectedModule.path}. Open a file to understand its responsibilities.`
        : selectedSubsystem
          ? `${selectedSubsystem.modules.length} modules in ${selectedSubsystem.path}. The graph now follows the project folder structure.`
          : graphSubtitle;
  const showActivity = Boolean(agentJob && agentJob.status !== "complete");
  const showActivityPanel = showActivity && activityPanelOpen;

  return (
    <main className="product-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">CG</span>
          <div><strong>ChangeGraph</strong><small>Understand code before approving it</small></div>
        </div>

        <div className="project-identity">
          <span>{stage === "baseline" ? "Understanding" : "Reviewing change in"}</span>
          <strong>{repository?.name ?? "Pricing service example"}</strong>
        </div>

        <div className="stage-switch" aria-label="Understanding workflow">
          <button type="button" className={stage === "baseline" ? "active" : ""} onClick={() => chooseStage("baseline")} aria-label="Existing code baseline" title="Existing code baseline">
            <span><BookOpen aria-hidden="true" /></span><strong>Baseline</strong><small>Existing code</small>
          </button>
          <button type="button" className={stage === "change" ? "active" : ""} disabled={!baselineReady} onClick={() => chooseStage("change")} aria-label="Change review" title="Change review">
            <span><GitCompareArrows aria-hidden="true" /></span><strong>Change</strong><small>Diff review</small>
          </button>
        </div>

        <div className="topbar-status">
          <span className="status-dot" />
          <div><strong>{analysis.classified} / {analysis.inventory.length}</strong><small>{stage === "baseline" ? "source lines mapped" : "changed lines explained"}</small></div>
        </div>
      </header>

      <nav className="view-tabs" aria-label="Workspace views">
        <button type="button" className={mobilePanel === "input" ? "active" : ""} onClick={() => setMobilePanel("input")} title={stage === "baseline" ? "Repository" : "Diff"}>
          {stage === "baseline" ? <FolderGit2 aria-hidden="true" /> : <GitCompareArrows aria-hidden="true" />}
          <strong>{stage === "baseline" ? "Repository" : "Diff"}</strong>
        </button>
        <button type="button" className={mobilePanel === "graph" ? "active" : ""} onClick={() => setMobilePanel("graph")} title="Map">
          <Network aria-hidden="true" />
          <strong>Map</strong>
        </button>
        <button type="button" className={mobilePanel === "inspect" ? "active" : ""} onClick={() => setMobilePanel("inspect")} title="Explain">
          <FileSearch2 aria-hidden="true" />
          <strong>Explain</strong>
        </button>
      </nav>

      <div className={`single-workspace mobile-panel-${mobilePanel}`}>
        <section className="input-view">
          <div className="setup-card">
            <header className="setup-header">
              <span className="section-label">{stage === "baseline" ? "Create the mental model" : "Review against the mental model"}</span>
              <h1>{stage === "baseline" ? "Choose the code you want to understand" : "Add the change you want to review"}</h1>
              <p>{stage === "baseline" ? "Start with a local repository. ChangeGraph turns its source into a navigable map of responsibilities and behavior." : "The diff is explained using the baseline map, so every change has existing-code context."}</p>
            </header>

            {stage === "baseline" ? (
              <section className="repository-card">
                <div className="repository-visual"><span>⌘</span><i /><i /><i /></div>
                <div className="repository-copy">
                  <strong>{repository ? repository.name : "Select a local repository"}</strong>
                  <p>{repository ? `${repository.files} supported files loaded. Files are mapped in parallel and unchanged results are reused.` : "Choose a folder once. ChangeGraph skips dependencies, build output, and generated directories."}</p>
                </div>
                <button type="button" onClick={chooseRepository}><FolderOpen aria-hidden="true" /><span>{repository ? "Change folder" : "Choose folder"}</span></button>
                <input ref={folderInputRef} type="file" multiple hidden onChange={handleFolderFallback} />
              </section>
            ) : (
              <label className="task-field" htmlFor="task"><span>Original coding task <i>optional</i></span><textarea id="task" rows={2} value={task} onChange={(event) => setTask(event.target.value)} /></label>
            )}

            <section className="source-editor">
              <header>
                <div><strong>{stage === "baseline" ? "Repository snapshot" : "Unified diff"}</strong><small>{stage === "baseline" ? "Paste code here if you do not want to choose a folder" : "Added and deleted lines will receive exact semantic owners"}</small></div>
                <button type="button" onClick={() => {
                  if (stage === "baseline") { setSource(SAMPLE_SOURCE); setRepository(null); setBaselineReady(false); }
                  else setDiff(SAMPLE_DIFF);
                }}>Load example</button>
              </header>
              <textarea
                id="code-input"
                value={stage === "baseline" ? source : diff}
                onChange={(event) => {
                  if (stage === "baseline") { setSource(event.target.value); setRepository(null); setBaselineReady(false); }
                  else setDiff(event.target.value);
                }}
                spellCheck={false}
                aria-label={stage === "baseline" ? "Repository source snapshot" : "Unified diff"}
              />
            </section>

            <footer className="setup-footer">
              <div className="engine-controls">
                <div className="provider-pills" aria-label="AI provider">
                  <button type="button" className={provider === "codex-local" ? "active" : ""} onClick={() => setProvider("codex-local")} aria-pressed={provider === "codex-local"}>Codex local</button>
                  <button type="button" className={provider === "openai-api" ? "active" : ""} onClick={() => setProvider("openai-api")} aria-pressed={provider === "openai-api"}>OpenAI API</button>
                </div>
                <label className="demo-control" htmlFor="demo-mode"><span className="sr-only">Toggle demo analysis</span><input id="demo-mode" type="checkbox" checked={demoMode} onChange={(event) => setDemoMode(event.target.checked)} /><span><i /></span>Demo</label>
              </div>
              <div className={`provider-health health-${demoMode ? "demo" : provider === "openai-api" ? "api" : providerHealth}`}>
                <span />
                <div>
                  <strong>{demoMode ? "Demo engine" : provider === "openai-api" ? "OpenAI API" : providerHealth === "ready" ? "Local Codex ready" : providerHealth === "checking" ? "Checking local Codex" : "Local Codex offline"}</strong>
                  <small>{demoMode ? "No service required" : provider === "openai-api" ? "Uses the server-side API key" : providerHealth === "offline" ? "Run npm run changegraph:service" : `${PARALLEL_ANALYSIS_WORKERS} parallel workers · local cache`}</small>
                </div>
                {!demoMode && provider === "codex-local" && providerHealth === "offline" ? <button type="button" onClick={() => void checkProviderHealth()}>Retry</button> : null}
              </div>
              <button type="button" className="run-button" onClick={runAnalysis} disabled={status === "running"}>{status === "running" ? "Analyzing…" : stage === "baseline" ? "Build baseline map" : "Explain this change"}<span>→</span></button>
            </footer>
            <div className={`status-message message-${status}`} role="status">
              <span>{message}</span>
              {status === "running" ? (
                <div className="analysis-progress" aria-label="Analysis progress">
                  {["Map files", "Parallel meaning", "Connect concepts"].map((label, index) => (
                    <span key={label} className={index < progressStep ? "done" : index === progressStep ? "active" : ""}>{index + 1}. {label}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="map-view" aria-label="Semantic code graph">
          <header className={`map-toolbar ${graphMode === "behavior" ? "behavior-map-toolbar" : ""}`}>
            <div>
              <span className="section-label">{hierarchyLabel}</span>
              <h1>{hierarchyTitle}</h1>
              <p>{hierarchyDescription}</p>
            </div>
            <div className="graph-mode-tabs" role="tablist" aria-label="Choose graph perspective">
              <button type="button" role="tab" aria-selected={graphMode === "structure"} className={graphMode === "structure" ? "active" : ""} onClick={() => chooseGraphMode("structure")}>
                <FolderTree aria-hidden="true" /><span>Structure</span><small>Project hierarchy</small>
              </button>
              <button type="button" role="tab" aria-selected={graphMode === "behavior"} className={graphMode === "behavior" ? "active" : ""} onClick={() => chooseGraphMode("behavior")}>
                <Workflow aria-hidden="true" /><span>System behavior</span><small>End-to-end HLD</small>
              </button>
            </div>
            <div className="map-actions">
              {agentJob ? <span className={`agent-job-badge agent-${agentJob.status}`} title={agentJob.status === "complete" ? "Agent map ready" : `${agentJob.completed}/${agentJob.total} analysis work units complete`}>{agentJob.status === "complete" ? "Agent map ready" : `${agentJob.completed}/${agentJob.total} agent work units`}</span> : null}
              {stage === "change" ? <span className="context-badge">Uses {baseline.nodes.length} baseline concepts</span> : null}
              <span className={`coverage-badge ${analysis.unknown ? "warning" : ""}`}>{analysis.unknown ? `${analysis.unknown} need inspection` : "Complete line coverage"}</span>
              {(graphMode === "behavior" ? focusedSystemNode : selectedFile) ? <button type="button" className="compact-action" onClick={() => setMobilePanel("inspect")} aria-label="Explain selected" title="Explain selected"><FileSearch2 aria-hidden="true" /><span>Explain</span></button> : <span className="hierarchy-hint">{graphMode === "behavior" ? "Select a behavior" : selectedModule ? "Open a file" : selectedSubsystem ? "Open a module" : "Open a subsystem"}</span>}
            </div>
          </header>
          <div className={`map-body ${showActivityPanel ? "has-activity" : ""}`}>
            {graphMode === "structure" ? <aside className="hierarchy-panel" aria-label="Code hierarchy">
              <header><span>Code structure</span><strong>System → subsystem → module → file → behavior → code</strong></header>
              <button type="button" className={`hierarchy-root ${!selectedSubsystem ? "active" : ""}`} onClick={() => openSubsystem(null)}>
                <span className="hierarchy-index">00</span><div><strong>{repository?.name ?? "Current repository"}</strong><small>{subsystemGroups.length} subsystems · {analysis.nodes.length} behaviors</small></div>
              </button>
              <div className="hierarchy-branches">
                {subsystemGroups.map((group, index) => (
                  <div className="hierarchy-group" key={group.id}>
                    <button type="button" className={selectedSubsystem?.id === group.id && !selectedModule ? "active" : ""} onClick={() => openSubsystem(group.id)}>
                      <span className="hierarchy-index">{String(index + 1).padStart(2, "0")}</span>
                      <div><strong>{group.title}</strong><small>{group.modules.length} modules · {group.files.length} files</small></div>
                      <i aria-hidden="true">›</i>
                    </button>
                    {selectedSubsystem?.id === group.id ? (
                      <div className="hierarchy-children modules">
                        {group.modules.map((module) => (
                          <div className="hierarchy-group" key={module.id}>
                            <button type="button" className={selectedModule?.id === module.id && !selectedFile ? "active" : ""} onClick={() => openModule(module.id)}>
                              <span className="tree-symbol">M</span><div><strong>{module.title}</strong><small>{module.files.length} files · {module.nodes.length} behaviors</small></div><i aria-hidden="true">›</i>
                            </button>
                            {selectedModule?.id === module.id ? (
                              <div className="hierarchy-children files">
                                {module.files.map((file) => (
                                  <button type="button" key={file.id} className={selectedFile?.id === file.id ? "active" : ""} onClick={() => openFile(file.id)}>
                                    <span className="tree-symbol file">F</span><div><strong>{file.title}</strong><small>{file.nodes.length} behaviors · {file.lineCount} lines</small></div><i aria-hidden="true">›</i>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </aside> : null}
            <div
              className={`hierarchy-stage ${graphMode === "behavior" || selectedFile ? "with-file-gallery" : ""} ${graphMode === "behavior" ? "behavior-hld" : ""}`}
              style={{ "--code-panel-width": `${codePanelWidth}px` } as CSSProperties}
            >
              <nav className="hierarchy-breadcrumb" aria-label="Current graph level">
                {graphMode === "behavior" ? (
                  <>
                    <strong>Repository</strong><span>›</span><em>Cross-module behavior HLD</em>
                    {activeSystemJourney ? <span className="dependency-lens-pill"><i />Journey: {activeSystemJourney.title}</span> : <span className="hld-overview-caption">Core system backbone · select a journey to see its complete connected flow</span>}
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => openSubsystem(null)}>System</button>
                    {selectedSubsystem ? <><span>›</span><button type="button" onClick={() => openSubsystem(selectedSubsystem.id)}>{selectedSubsystem.title}</button></> : <><span>›</span><strong>Subsystems</strong></>}
                    {selectedModule ? <><span>›</span><button type="button" onClick={() => openModule(selectedModule.id)}>{selectedModule.title}</button></> : selectedSubsystem ? <><span>›</span><strong>Modules</strong></> : null}
                    {selectedFile ? <><span>›</span><strong>{selectedFile.title}</strong><span>›</span><em>Contained behaviors</em></> : selectedModule ? <><span>›</span><strong>Files</strong></> : null}
                    {focusedNodeId && selectedFile ? <span className="dependency-lens-pill"><i />Dependency lens: {selectedNode?.data.codeIdentity || selectedNode?.data.title}</span> : null}
                  </>
                )}
                <button type="button" className="fit-graph-button compact-action" onClick={fitWholeGraph} aria-label="Fit the complete visible graph on screen" title="Fit whole graph"><Maximize2 aria-hidden="true" /><span>Fit graph</span></button>
                {graphMode === "structure" && !selectedFile && focusedNodeIndex >= 0 && orderedVisibleNodes.length > 1 ? (
                  <div className="node-sequence-nav" aria-label="Navigate visible tiles">
                    <span aria-live="polite">{focusedNodeIndex + 1} of {orderedVisibleNodes.length}</span>
                    <button type="button" className="icon-button" onClick={() => navigateFocusedNode(-1)} disabled={focusedNodeIndex === 0} aria-label="Previous tile" title="Previous tile"><ChevronLeft aria-hidden="true" /></button>
                    <button type="button" className="icon-button" onClick={() => navigateFocusedNode(1)} disabled={focusedNodeIndex === orderedVisibleNodes.length - 1} aria-label="Next tile" title="Next tile"><ChevronRight aria-hidden="true" /></button>
                  </div>
                ) : null}
              </nav>
              {graphMode === "behavior" ? (
                <div className="file-gallery-toolbar system-behavior-toolbar" aria-label="Navigate end-to-end journeys across the system">
                  <div className="gallery-position">
                    <span>System journeys</span>
                    <strong>{activeSystemJourneyIndex < 0 ? `${systemJourneys.length} grouped` : `${activeSystemJourneyIndex + 1} of ${systemJourneys.length}`}</strong>
                    <small className={`journey-order-status status-${journeyOrderStatus}`}>{demoMode ? "Deterministic reading order" : journeyOrderStatus === "ordering" ? "AI is ordering the reading path…" : journeyOrderStatus === "ready" ? "AI reading order ready" : journeyOrderStatus === "error" ? "Using safe reading order" : "Reading order available"}</small>
                  </div>
                  <button type="button" className="icon-button" onClick={() => navigateSystemBehavior(-1)} disabled={activeSystemJourneyIndex <= 0} aria-label="Previous system journey" title="Previous journey"><ChevronLeft aria-hidden="true" /></button>
                  <label>
                    <span>Jump to a complete journey</span>
                    <select value={activeSystemJourney?.id ?? ""} onChange={(event) => selectSystemJourney(event.target.value)}>
                      <option value="" disabled>Choose an end-to-end journey…</option>
                      {systemJourneyGroups.map((group) => (
                        <optgroup key={group.phase} label={journeyPhaseLabel(group.phase)}>
                          {group.journeys.map((journey) => {
                            const index = systemJourneys.findIndex((candidate) => candidate.id === journey.id);
                            return <option key={journey.id} value={journey.id}>{index + 1}. {journey.title} — {journey.description}</option>;
                          })}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="icon-button" onClick={() => navigateSystemBehavior(1)} disabled={activeSystemJourneyIndex >= systemJourneys.length - 1} aria-label="Next system journey" title="Next journey"><ChevronRight aria-hidden="true" /></button>
                  {activeSystemJourney ? <button type="button" className="hld-overview-button compact-action" onClick={() => { setFocusedNodeId(null); setSelectedDependencyEdgeId(null); }} aria-label="Return to system behavior overview" title="HLD overview"><LayoutDashboard aria-hidden="true" /><span>Overview</span></button> : null}
                  {activeSystemJourney && activeJourneySteps.length ? (
                    <div className="journey-step-nav" aria-label="Navigate ordered steps in this journey">
                      <span><i />{journeyStageStatus[activeSystemJourney.id] === "ordering" ? "AI is grouping stages…" : journeyStageStatus[activeSystemJourney.id] === "error" ? `Safe stage order · ${Math.max(1, activeJourneyStepIndex + 1)}/${activeJourneySteps.length}` : `Step ${Math.max(1, activeJourneyStepIndex + 1)} of ${activeJourneySteps.length}`}</span>
                      <button type="button" className="icon-button" onClick={() => navigateJourneyStep(-1)} disabled={activeJourneyStepIndex <= 0} aria-label="Previous journey step" title="Previous step"><ChevronLeft aria-hidden="true" /></button>
                      <button type="button" className="icon-button" onClick={() => navigateJourneyStep(1)} disabled={activeJourneyStepIndex >= activeJourneySteps.length - 1} aria-label="Next journey step" title="Next step"><ChevronRight aria-hidden="true" /></button>
                    </div>
                  ) : null}
                  {focusedSystemNode && dependencyNavigationEdges.length ? (
                    <div className="gallery-dependency-nav" aria-label="Navigate connected relationships">
                      <span><i />{selectedDependencyIndex < 0 ? `${dependencyNavigationEdges.length} connections` : `${selectedDependencyIndex + 1} of ${dependencyNavigationEdges.length}`}</span>
                      <button type="button" className="icon-button" onClick={() => navigateDependency(-1)} aria-label="Previous connection" title="Previous connection"><ChevronLeft aria-hidden="true" /></button>
                      <button type="button" className="icon-button" onClick={() => navigateDependency(1)} aria-label="Next connection" title="Next connection"><ChevronRight aria-hidden="true" /></button>
                    </div>
                  ) : null}
                </div>
              ) : selectedFile ? (
                <div className="file-gallery-toolbar" aria-label="Navigate behaviors in selected file">
                  <div className="gallery-position"><span>Behavior gallery</span><strong>{Math.max(1, activeFileBehaviorIndex + 1)} of {orderedFileBehaviors.length}</strong></div>
                  <button type="button" className="icon-button" onClick={() => navigateFileBehavior(-1)} disabled={activeFileBehaviorIndex <= 0} aria-label="Previous behavior" title="Previous behavior"><ChevronLeft aria-hidden="true" /></button>
                  <label>
                    <span>Jump to behavior</span>
                    <select value={focusedNodeId ?? orderedFileBehaviors[0]?.id ?? ""} onChange={(event) => selectFileBehavior(event.target.value)}>
                      {orderedFileBehaviors.map((node, index) => <option key={node.id} value={node.id}>{index + 1}. {node.data.codeIdentity || node.data.title}</option>)}
                    </select>
                  </label>
                  <button type="button" className="icon-button" onClick={() => navigateFileBehavior(1)} disabled={activeFileBehaviorIndex < 0 || activeFileBehaviorIndex >= orderedFileBehaviors.length - 1} aria-label="Next behavior" title="Next behavior"><ChevronRight aria-hidden="true" /></button>
                  {dependencyNavigationEdges.length ? (
                    <div className="gallery-dependency-nav" aria-label="Navigate dependencies">
                      <span><i />{selectedDependencyIndex < 0 ? `${dependencyNavigationEdges.length} dependencies` : `${selectedDependencyIndex + 1} of ${dependencyNavigationEdges.length}`}</span>
                      <button type="button" className="icon-button" onClick={() => navigateDependency(-1)} aria-label="Previous dependency" title="Previous dependency"><ChevronLeft aria-hidden="true" /></button>
                      <button type="button" className="icon-button" onClick={() => navigateDependency(1)} aria-label="Next dependency" title="Next dependency"><ChevronRight aria-hidden="true" /></button>
                    </div>
                  ) : <span className="gallery-no-dependencies">No mapped dependencies</span>}
                </div>
              ) : null}
              <div className={`graph-workspace ${codePanelOpen && selectedNode ? "with-code-panel" : ""}`}>
              <div className={`map-canvas graph-zoom-${zoomMode}`}>
                <ReactFlow
                  key={`${stage}-${graphMode}`}
                  nodes={renderedNodes}
                  edges={visibleEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodeClick={(_, node) => {
                    if (node.type === "subsystem") {
                      setFocusedNodeId(null);
                      setSelectedDependencyEdgeId(null);
                      const structure = node.data as StructureNodeData;
                      if (structure.level === "system") openSubsystem(null);
                      else if (structure.level === "subsystem") openSubsystem(structure.structureId);
                      else if (structure.level === "module") openModule(structure.structureId);
                      else openFile(structure.structureId);
                      return;
                    }
                    if (node.type === "fileContainer" || node.type === "journeyStage") return;
                    const semanticId = (node.data as SemanticNodeData).semanticId || node.id;
                    if (graphMode === "behavior") {
                      selectSystemBehavior(semanticId);
                      return;
                    }
                    const owner = behaviorOwnership.get(semanticId);
                    if (owner && owner.fileId !== activeFile) {
                      setActiveSubsystem(owner.subsystemId);
                      setActiveModule(owner.moduleId);
                      setActiveFile(owner.fileId);
                    }
                    setFocusedNodeId(semanticId);
                    setSelectedDependencyEdgeId(null);
                    setSelectedId(semanticId);
                    setCodePanelOpen(true);
                  }}
                  onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
                  onEdgeMouseLeave={() => setHoveredEdgeId(null)}
                  onEdgeClick={(_, edge) => {
                    setHoveredEdgeId(edge.id);
                    if ((edge.data as DependencyEdgeData | undefined)?.dependency) setSelectedDependencyEdgeId(edge.id);
                  }}
                  onPaneClick={() => {
                    if (graphMode === "structure" && !selectedFile) setFocusedNodeId(null);
                    setHoveredEdgeId(null);
                    setSelectedDependencyEdgeId(null);
                  }}
                  onMove={(_, viewport) => setZoomMode((current) => {
                    const next = graphZoomMode(viewport.zoom);
                    return current === next ? current : next;
                  })}
                  onInit={(instance) => {
                    graphInstanceRef.current = instance as unknown as ReactFlowInstance;
                    const root = visibleGraph.nodes[0];
                    const initialZoom = compact ? .68 : .82;
                    setZoomMode(graphZoomMode(initialZoom));
                    void instance.setCenter(650, root.position.y + 100, { zoom: initialZoom, duration: 0 });
                  }}
                  minZoom={0.06}
                  maxZoom={3.2}
                  nodesDraggable={false}
                  panOnDrag
                  panOnScroll
                  panOnScrollSpeed={0.8}
                  zoomOnScroll={false}
                  zoomOnPinch
                  zoomOnDoubleClick
                  preventScrolling
                  proOptions={{ hideAttribution: true }}
                >
                  <GraphInternalsSync nodeIds={visibleNodeIds} enabled={mobilePanel === "graph"} syncKey={`${zoomMode}:${[...collapsedNodeIds].sort().join(",")}`} />
                  <Background color="#3C3C3C" gap={32} size={1} variant={BackgroundVariant.Dots} />
                  <Controls showInteractive={false} fitViewOptions={{ padding: .12, minZoom: .06, maxZoom: .82, duration: 620 }} />
                </ReactFlow>
                {selectedDependency ? (
                  <aside className={`dependency-inspector scope-${selectedDependency.scope}`} aria-label={`${selectedDependency.scope === "same-file" ? "Same-file" : "Cross-file"} dependency details`}>
                    <header>
                      <div><span>{selectedDependency.scope === "same-file" ? "Same-file dependency" : "Cross-file dependency"}</span><strong>{selectedDependency.sourceTitle} → {selectedDependency.targetTitle}</strong></div>
                      <button type="button" className="icon-button" onClick={() => setSelectedDependencyEdgeId(null)} aria-label="Close dependency details" title="Close dependency details"><X aria-hidden="true" /></button>
                    </header>
                    <div className="dependency-summary"><b>{selectedDependency.count}</b><span>{selectedDependency.primaryLabel.toLowerCase()} relationship{selectedDependency.count === 1 ? "" : "s"}</span></div>
                    <ol>
                      {selectedDependency.members.slice(0, 8).map((member, index) => (
                        <li key={`${member.source}-${member.target}-${index}`}>
                          <span>{member.plainLabel}</span>
                          <strong>{member.sourceTitle} → {member.targetTitle}</strong>
                          <small>{member.sourceFile} → {member.targetFile}</small>
                        </li>
                      ))}
                    </ol>
                    {selectedDependency.members.length > 8 ? <footer>+ {selectedDependency.members.length - 8} more exact relationships</footer> : null}
                  </aside>
                ) : null}
                {!codePanelOpen && selectedNode ? (
                  <button type="button" className="code-panel-rail" onClick={() => setCodePanelOpen(true)} aria-label={`Open code evidence for ${selectedNode.data.title}`}>
                    <PanelRightOpen aria-hidden="true" /><span>Code</span><small>{selectedNode.data.lineIds.length}</small>
                  </button>
                ) : null}
              </div>
              {codePanelOpen && selectedNode ? (
                <CodeEvidencePanel
                  key={`${agentJob?.id ?? "local"}-${selectedNode.id}-${selectedNode.data.lineIds.length}`}
                  node={selectedNode}
                  stage={stage}
                  inventory={analysis.inventory}
                  sourceFiles={sourceFiles}
                  jobId={agentJob?.id}
                  width={codePanelWidth}
                  onWidthChange={setCodePanelWidth}
                  onCollapse={() => setCodePanelOpen(false)}
                />
              ) : null}
              </div>
            </div>
            {showActivityPanel ? <div className="activity-rail"><AnalysisActivity job={agentJob} conceptCount={analysis.nodes.length} subsystemCount={subsystemGroups.length} onCollapse={() => setActivityPanelOpen(false)} /></div> : null}
            {showActivity && !activityPanelOpen ? (
              <button type="button" className={`activity-panel-rail ${agentJob?.status === "error" ? "has-error" : ""}`} onClick={() => setActivityPanelOpen(true)} aria-label="Open analysis status panel">
                <Activity aria-hidden="true" /><span>{agentJob?.status === "error" ? "Analysis stopped" : "Analysis activity"}</span><small>Open</small>
              </button>
            ) : null}
          </div>
        </section>

        <section className="explain-view">
          {selectedNode ? (
            <div className="explain-shell">
              <header className="explain-heading">
                <button type="button" onClick={() => setMobilePanel("graph")}>← Back to map</button>
                <div className="explain-tags"><span className={`kind-tag kind-${selectedNode.data.kind}`}>{selectedNode.data.kind}</span><span>{selectedNode.data.confidence} confidence</span><span>{selectedNode.data.lineIds.length} owned lines</span></div>
                <h1>{selectedNode.data.title}</h1>
                <p>{selectedNode.data.summary}</p>
              </header>

              <div className="explain-content">
                <aside className="meaning-pane">
                  <span className="section-label">{stage === "baseline" ? "Existing behavior" : "Behavior change"}</span>
                  {stage === "baseline" ? <p>{selectedNode.data.summary}</p> : (
                    <div className="before-after">
                      <div><span>Before</span><strong>{selectedNode.data.before}</strong></div>
                      <b>↓</b>
                      <div><span>After</span><strong>{selectedNode.data.after}</strong></div>
                    </div>
                  )}
                  <details className="line-ledger">
                    <summary>Line ownership ledger <span>{selectedNode.data.lineIds.length}</span></summary>
                    <div>{selectedNode.data.lineIds.map((id) => <code key={id}>{id}</code>)}</div>
                  </details>
                </aside>

                <div className="code-pane">
                  {stage === "baseline" ? (
                    <section className="code-card source-code"><header><strong>Exact source</strong><span>{selectedNode.data.lineIds.length} lines</span></header><pre>{selectedNode.data.sourceCode}</pre></section>
                  ) : (
                    <div className="code-comparison">
                      <section className="code-card removed-code"><header><strong>Before</strong><span>{selectedNode.data.lineIds.filter((id) => id.startsWith("old:")).length} deleted</span></header><pre>{selectedNode.data.beforeCode}</pre></section>
                      <section className="code-card added-code"><header><strong>After</strong><span>{selectedNode.data.lineIds.filter((id) => id.startsWith("new:")).length} added</span></header><pre>{selectedNode.data.afterCode}</pre></section>
                    </div>
                  )}
                </div>
              </div>

              {stage === "baseline" && baselineReady ? <button type="button" className="continue-button" onClick={() => chooseStage("change")}>Continue to change review <span>→</span></button> : null}
            </div>
          ) : <div className="empty-state">Select a concept from the map to explain it.</div>}
        </section>
      </div>
    </main>
  );
}
