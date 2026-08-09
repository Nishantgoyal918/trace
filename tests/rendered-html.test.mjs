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
  assert.match(html, /Understand code before approving it/);
  assert.match(html, /Existing code/);
  assert.match(html, /Select a local repository/);
  assert.match(html, /How the existing code works/);
  assert.match(html, /System → subsystem → module → file → behavior → code/);
  assert.match(html, /Code structure/);
  assert.match(html, /Exact source/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps both AI provider paths explicit", async () => {
  const [page, styles, route, bridge, packageJson, codexPlugin, claudePlugin] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../local-bridge/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../integrations/codex/changegraph/.codex-plugin/plugin.json", import.meta.url), "utf8"),
    readFile(new URL("../integrations/claude/changegraph/.claude-plugin/plugin.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Codex local/);
  assert.match(page, /OpenAI API/);
  assert.match(page, /Toggle demo analysis/);
  assert.match(page, /showDirectoryPicker/);
  assert.match(page, /Build baseline map/);
  assert.match(page, /buildAnalysisBatches/);
  assert.match(page, /buildSubsystemGroups/);
  assert.match(page, /buildModuleGroups/);
  assert.match(page, /buildFileGroups/);
  assert.match(page, /layoutExpandedGraph/);
  assert.match(page, /layoutSystemBehaviorGraph/);
  assert.match(page, /arrangeHldRanks/);
  assert.match(page, /median/);
  assert.doesNotMatch(page, /outer-lane-edge|routeHldEdges/);
  assert.match(page, /crossModuleAdjacency/);
  assert.match(page, /End-to-end HLD/);
  assert.match(page, /buildSystemJourneys/);
  assert.match(page, /behaviorIdentity/);
  assert.match(page, /aliases for the same behavior/);
  assert.doesNotMatch(page, /segments\.slice\(0, 3\)/);
  assert.match(page, /Jump to a complete journey/);
  assert.match(page, /AI reading order ready/);
  assert.match(page, /JourneyStageView/);
  assert.match(page, /journey-stage-node/);
  assert.match(page, /Navigate ordered steps in this journey/);
  assert.match(page, /validateJourneyOrderPlan/);
  assert.match(page, /validateJourneyStagePlan/);
  assert.match(page, /Connected steps stay together/);
  assert.match(page, /panOnScroll/);
  assert.match(page, /panOnDrag/);
  assert.match(page, /autoFitKeyRef/);
  assert.doesNotMatch(page, /Jump to any behavior/);
  assert.match(page, /rankBehaviorGraph/);
  assert.match(page, /finalizeGraph/);
  assert.match(page, /NodePortHandles/);
  assert.match(page, /node-source-path/);
  assert.match(page, /showSourcePath/);
  assert.match(page, /FileContainerView/);
  assert.match(page, /Same-file dependency/);
  assert.match(page, /Behavior gallery/);
  assert.match(page, /dependencyScope/);
  assert.match(page, /semanticId/);
  assert.match(page, /relationState/);
  assert.match(page, /const path = `M \$\{sourceX\},\$\{sourceY\} C /);
  assert.doesNotMatch(page, /getSmoothStepPath|getStraightPath/);
  assert.match(page, /rankColumnStep/);
  assert.match(page, /stageCursorY/);
  assert.match(page, /count: layout\.nodes\.length/);
  assert.match(page, /const stagePadding = 68/);
  assert.doesNotMatch(page, /count: stageNodes\.length/);
  assert.match(page, /CodeEvidencePanel/);
  assert.match(page, /@monaco-editor\/react/);
  assert.match(page, /from "lucide-react"/);
  assert.match(page, /PanelRightClose/);
  assert.match(page, /behavior-map-toolbar/);
  assert.match(page, /behavior-hld/);
  assert.match(page, /highlighted lines are the evidence attributed/);
  assert.match(page, /refreshEvidenceDecorations/);
  assert.match(page, /#23AFD0/);
  assert.match(page, /#8E85FF/);
  assert.match(page, /automaticLayout: false/);
  assert.match(page, /resize-preview-offset/);
  assert.match(page, /if \(nextWidth !== startWidth\) onWidthChange\(nextWidth\)/);
  assert.match(page, /theme="vs-dark"/);
  assert.match(page, /node-collapse-button/);
  assert.match(page, /collapsedNodeIds/);
  assert.match(page, /const mode: CodePanelMode = "full"/);
  assert.match(page, /The complete file is shown/);
  assert.match(page, /jobs\/latest/);
  assert.match(page, /repositoryFilesFromSource\(String\(payload\.source/);
  assert.doesNotMatch(page, /Showing attributed lines instead/);
  assert.match(page, /Full file/);
  assert.match(page, /Collapse code evidence panel/);
  assert.match(page, /code-panel-collapse/);
  assert.match(page, /activityPanelOpen/);
  assert.match(page, /Collapse analysis status panel/);
  assert.match(page, /Open analysis status panel/);
  assert.match(styles, /--surface: #101011/);
  assert.match(styles, /--accent: #66d6bf/);
  assert.match(styles, /Clean minimal visual system/);
  assert.match(styles, /Graph semantic color layer/);
  assert.match(styles, /background: rgba\(var\(--node-rgb\), \.09\)/);
  assert.doesNotMatch(styles, /\.map-canvas \{[^}]*radial-gradient/s);
  assert.match(styles, /\.code-evidence-panel/);
  assert.match(styles, /monaco-evidence-line/);
  assert.match(styles, /semantic-node\.is-collapsed/);
  assert.match(styles, /VS Code workbench palette/);
  assert.match(styles, /Unified editor-inspired semantic palette/);
  assert.match(styles, /Text-first activity rail/);
  assert.match(styles, /Shared graph workspace/);
  assert.match(styles, /is-previewing::before/);
  assert.match(styles, /Compact Lucide interface icon system/);
  assert.match(styles, /Compact section rhythm/);
  assert.match(styles, /Radix Slate \+ Iris palette/);
  assert.match(styles, /Minimal workspace mode/);
  assert.match(styles, /Clearly frosted node surfaces/);
  assert.match(styles, /Persistent code-panel escape hatch/);
  assert.match(styles, /backdrop-filter: blur\(16px\) saturate\(140%\)/);
  assert.match(styles, /--iris-solid: #5b5bd6/);
  assert.match(page, /className={`graph-workspace/);
  assert.doesNotMatch(page, /<span>0[123]<\/span>/);
  assert.match(page, /graphInstanceRef/);
  assert.match(page, /instance\.fitView/);
  assert.doesNotMatch(page, /Previous nodes|Next nodes|graphPage/);
  assert.match(page, /Live analysis activity/);
  assert.match(page, /First results can take a few minutes/);
  assert.doesNotMatch(page, /MAX_REPOSITORY_FILES|MAX_REPOSITORY_CHARS|POC size limit/);
  assert.match(route, /OPENAI_API_KEY/);
  assert.match(route, /No fallback provider was used/);
  assert.match(route, /plain, simple English/);
  assert.match(route, /what starts this behavior/);
  assert.match(route, /repository-wide architecture pass/);
  assert.match(route, /frontend requests/);
  assert.match(route, /database tables or collections/);
  assert.match(route, /buildJourneyOrderingPrompt/);
  assert.match(route, /journey_reading_order/);
  assert.match(route, /journey_stage_order/);
  assert.doesNotMatch(route, /180_000|4_000|accepts up to/);
  assert.match(bridge, /@openai\/codex-sdk/);
  assert.match(bridge, /No fallback provider was used/);
  assert.match(bridge, /PARALLEL_WORKERS/);
  assert.match(bridge, /plain, simple English/);
  assert.match(bridge, /what happens step by step/);
  assert.match(bridge, /semantic-v7-end-to-end-architecture/);
  assert.match(bridge, /function architectureWindows/);
  assert.match(bridge, /frontend requests to backend endpoints/);
  assert.match(bridge, /backend behavior to database and storage/);
  assert.match(bridge, /architectureConnected/);
  assert.match(bridge, /buildJourneyOrderingPrompt/);
  assert.match(bridge, /journey_reading_order/);
  assert.match(bridge, /journey_stage_order/);
  assert.match(bridge, /\/jobs/);
  assert.match(bridge, /requestUrl\.pathname === "\/file"/);
  assert.match(bridge, /outside the analyzed repository/);
  assert.doesNotMatch(bridge, /Input is too large for this POC|220_000/);
  assert.match(packageJson, /"codex:bridge"/);
  assert.match(packageJson, /"@monaco-editor\/react"/);
  assert.match(packageJson, /"lucide-react"/);
  assert.match(codexPlugin, /"name": "changegraph"/);
  assert.match(codexPlugin, /"mcpServers"/);
  assert.match(claudePlugin, /"name": "changegraph"/);
});
