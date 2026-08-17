# Pipeline Performance Optimization Plan

## Objective

Make repository analysis fast enough to be useful during normal engineering work while preserving the evidence coverage and end-to-end behavior graph that distinguish Trace from a code summary.

The primary success criterion is not merely faster completion. The user should receive a meaningful, navigable graph quickly, and the remaining detail should refine that graph incrementally without blocking exploration.

## Optimization implementation on this branch

Implemented in the first performance slice:

- **Honest file-first leaf scheduling:** repository work is pre-sized inside one file at a time to 120 non-empty lines or roughly 12,000 characters, given a stable content-derived leaf ID, and scheduled globally. The default semantic concurrency is six workers. Recursive splitting remains only as exceptional failure recovery rather than the normal hidden execution path.
- **Deterministic contract connections:** exact HTTP, database, queue, event, cache, object-store, and uniquely owned symbol contracts produce high-confidence edges locally with evidence and provenance. Ambiguous ownership is deliberately left to AI to avoid a combinatorial edge mesh.
- **Bounded ambiguous integration:** broad connection inference is capped at 20 AI windows per job instead of allowing repository size and overlapping architecture windows to grow the call count without a bound.
- **Purpose-specific provider profiles:** extraction and first coverage repair use low reasoning; a second failed repair and integration/ordering use medium reasoning. Codex runs read-only with networking and web search disabled, receives an output schema, reuses one SDK client, and aborts the active turn on timeout.
- **Validated compact evidence:** model requests use local `L0001` references and inclusive spans instead of repeating long repository IDs. Every response passes a deterministic ownership gate. Missing evidence receives up to two focused repair passes; anything still unresolved becomes an explicit low-confidence unknown node instead of disappearing.
- **Persisted telemetry:** every provider attempt records phase, leaf identity, timing, model/profile, usage when available, cache state, and categorized failures. Job results include P50/P95/max request latency, attempts, failures, cache hits, split recovery, and token totals.
- **Smaller semantic output:** the extraction contract keeps detailed ordered bullets while reducing prompt-imposed behavior and prose inflation.
- **Reproducible dry benchmark:** `npm run pipeline:benchmark -- <graph-record.json>` compares a persisted graph with the optimized scheduling and deterministic-edge plan without making provider calls.

Dry-running the backed-up Cierge graph currently yields:

| Measurement | Previous | Optimized dry run |
| --- | ---: | ---: |
| Displayed/schedulable semantic units | 43 displayed / ~165 actual | 178 explicit global leaves |
| AI connection calls | 89 | no more than 20 |
| Deterministic evidence-backed edges | not distinguished | 2,561 |
| Avoided AI connection calls | 0 | at least 69 |

The 2,561 deterministic edges result includes only uniquely selected providers or bounded typed producer/consumer pairs. An earlier naïve exact-match implementation produced 7,711 edges and was rejected before launch because it would have recreated an unreadable graph mesh.

## Measured baseline

The latest complete `cierge-dev` analysis provides the current baseline:

| Measurement | Observed value |
| --- | ---: |
| Repository files included | 299 |
| Source size | ~1.02 million characters |
| Non-empty source lines | ~24,422 |
| Displayed analysis work units | 43 |
| Actual semantic model calls | ~165 |
| Cross-file and architecture model calls | 89 |
| Total model calls | ~254 |
| Generated nodes | 2,048 |
| Generated edges | 8,067 |
| Semantic analysis duration | ~2 hours 11 minutes |
| Connection phase duration | ~1 hour 46 minutes |
| End-to-end duration | ~4 hours 1 minute |
| Cache hits for that fresh run | 0 |

These numbers are reconstructed from the persisted job and cache timestamps. Retry count, queue time, model usage, and individual request latency are not currently recorded, so the true upstream request count may be higher.

## Current pipeline and principal bottlenecks

```text
Collect repository
  -> create 43 large file-aware batches
  -> recursively split most batches into ~165 leaf requests
  -> run leaf requests through 4 parent workers
  -> merge ~2,048 behavior nodes
  -> create overlapping semantic and architecture windows
  -> send 89 more model requests through 3 workers
  -> merge ~8,067 edges
  -> persist graph
```

### 1. Hidden request multiplication

The UI reports 43 work units, but proactive recursive splitting turns those units into approximately 165 semantic provider calls. Split children execute sequentially inside a parent work item. This both hides actual progress and prevents the global scheduler from distributing all available leaf work efficiently.

### 2. AI is used for deterministic relationships

The connection phase sends 89 overlapping windows to the model. Many relationships are already explicitly represented by canonical contracts such as matching HTTP routes, queue names, storage operations, or exact consumed/provided symbols. Re-asking AI to discover these relationships adds substantial time and can produce duplicate or inconsistent edges.

### 3. Every local request starts a fresh Codex execution

Each request creates a new Codex thread and the SDK launches a CLI subprocess for the turn. The model, reasoning effort, structured output schema, and tool restrictions are not configured explicitly. This is expensive for hundreds of repetitive extraction requests.

### 4. Full detail blocks the useful result

Repository overview, detailed line ownership, ambiguous cross-file inference, and HLD construction are treated as one completion path. A user waits for all file details before the repository-wide connection phase even starts.

### 5. Cache boundaries are too broad and fragile

Analysis caching is request-body based. Content movement, batch repacking, prompt changes, and line-number changes can invalidate work that remains semantically unchanged. Extraction, taxonomy, connections, and presentation also share coupled versioning concerns.

### 6. Performance cannot yet be attributed precisely

The service does not persist per-request timings, token usage, retry count, split ancestry, queue delay, model, or reasoning effort. Optimization without this telemetry risks trading quality for speed without knowing which change helped.

## Target experience and budgets

Targets should be validated on `cierge-dev` and at least two differently structured repositories.

| Outcome | Cold repository target | Incremental target |
| --- | ---: | ---: |
| Repository inventory visible | < 5 seconds | < 2 seconds |
| Meaningful architecture preview | < 10 minutes | < 2 minutes |
| Selected subsystem detailed | < 15 minutes | < 3 minutes |
| Full evidence-complete graph | < 60 minutes | < 10 minutes |
| Reopening an unchanged snapshot | < 5 seconds | < 5 seconds |

Guardrails:

- Every included source line must retain visible ownership or a visible `unknown` classification.
- Exact code evidence and file/line attribution must remain intact.
- Frontend-to-backend and backend-to-data or external-system paths must not regress.
- Fallbacks, errors, retries, configuration, and state changes must remain visible.
- Deterministic edges must communicate their evidence and confidence distinctly from AI-inferred edges.

## Prioritized optimization program

## P0 — Instrument the real pipeline

**Why first:** We know aggregate duration and reconstructed call counts, but not the latency distribution or retry amplification. All later work should produce comparable evidence.

Add a durable event record for every unit and provider attempt:

- Job ID, phase, logical unit ID, leaf unit ID, and split ancestry.
- Queued, started, first-event, and completed timestamps.
- Input characters, inventory lines, files, nodes, and edges.
- Provider, model, reasoning effort, attempt number, and result status.
- Cache hit/miss and cache key family.
- Input, cached-input, reasoning, and output tokens when available.
- Failure category: timeout, transport, invalid JSON, schema mismatch, rate limit, or other.

Expose phase-level summaries through the job API and dashboard:

- Real completed leaf requests / total leaf requests.
- P50, P95, and maximum latency.
- Queue wait versus provider time.
- Retry and split counts.
- Estimated remaining work based on recent throughput.

**Acceptance criteria**

- A completed job can explain its elapsed time without reconstructing cache timestamps.
- Displayed progress uses actual scheduled leaf units.
- A benchmark report can compare two pipeline versions from persisted data.

**Expected direct speedup:** none; enables safe optimization.

## P1 — Flatten splitting into a global leaf work queue

**Why high value:** The current scheduler has four parent workers, while child splits are sequential within each parent. All leaf units should compete in one bounded queue.

Plan:

1. Split batches before execution using a single, explicit sizing policy.
2. Give every leaf a stable identity based on file content and covered ranges.
3. Schedule all leaves through one concurrency limiter.
4. Report leaf progress directly while retaining file and parent grouping in the UI.
5. Make concurrency provider-specific and configurable.
6. Add adaptive backpressure after rate limits or repeated transport failures.

Start with controlled benchmarks at 4, 6, and 8 concurrent requests. Do not assume higher concurrency is always faster; local Codex subprocesses and upstream limits may saturate.

**Acceptance criteria**

- No recursive provider calls execute serially inside a parent queue slot.
- The UI's total equals the number of schedulable analysis leaves.
- Output is deterministic regardless of request completion order.
- Eight-worker testing does not increase failure or retry rate materially.

**Estimated impact:** 20–40% reduction in semantic phase wall time, depending on provider saturation.

## P2 — Build deterministic edges before AI integration

**Why high value:** The 89-call connection phase consumes roughly 44% of the current runtime.

Create a deterministic contract index from the already-generated `provides`, `uses`, file evidence, and repository identity:

- Exact function, method, class, and exported-symbol contracts.
- Normalized HTTP method and route.
- Queue publish/consume names.
- Event emit/receive names.
- Database read/write resource names.
- Cache read/write keys or resources.
- Object-store read/write buckets or resources.
- Explicit configuration keys.

Emit high-confidence edges directly when exact contracts match and direction is known. Preserve provenance on every edge:

```json
{
  "source": "node-a",
  "target": "node-b",
  "label": "sends the catalog request",
  "origin": "deterministic-contract",
  "evidence": ["HTTP POST /api/v1/catalog-jobs"],
  "confidence": "high"
}
```

Only send unresolved candidates to AI. Candidate generation should use exact normalized identifiers and a small scored shortlist rather than overlapping windows over every node.

**Acceptance criteria**

- Exact contract matches require zero integration-model calls.
- AI receives only ambiguous candidate subgraphs.
- Connection model calls fall from 89 to no more than 20 on the baseline repository.
- A sampled edge evaluation shows no material loss in valid cross-module paths.
- Duplicate edges are eliminated by canonical edge identity.

**Estimated impact:** 60–85% reduction in connection phase; approximately 60–95 minutes saved on the baseline.

## P3 — Deliver a progressive graph in independent passes

**Why high value:** Even an optimized complete run is too slow if nothing coherent is available early.

Split the product result into explicit quality levels:

1. **Inventory:** repository, subsystem, module, and file structure.
2. **Architecture preview:** entry points, boundaries, canonical contracts, and major runtime paths.
3. **Behavior detail:** evidence-complete file and function behaviors.
4. **Ambiguity refinement:** AI-resolved cross-file relationships and journey ordering.

Run a lightweight architecture pass early using compact file manifests and high-signal excerpts. Detailed leaves then replace preview nodes without changing stable conceptual identities where possible.

Prioritize work dynamically:

- Entry points and external boundaries first.
- Files needed by the visible architecture path next.
- The subsystem or node selected by the user moves to the front of the queue.
- Tests, docs, and low-connectivity leaves may follow unless they are the selected evidence.

**Acceptance criteria**

- A coherent cross-module preview is navigable before detailed analysis completes.
- Preview nodes visibly indicate provisional status.
- Refinement preserves viewport, selection, journey identity, and stable nodes where supported.
- Selecting an unanalyzed area reprioritizes it without restarting the job.

**Estimated impact:** meaningful graph in 5–10 minutes even when full completion takes longer.

## P4 — Use purpose-specific provider profiles

**Why high value:** Bulk extraction, ambiguous integration, and journey ordering have different reasoning needs.

Define explicit profiles rather than inheriting provider defaults:

| Workload | Desired profile |
| --- | --- |
| Line ownership and behavior extraction | Fast model, low reasoning, strict schema, tools disabled |
| Deterministic contract connection | No model |
| Ambiguous relationship resolution | Balanced model, low/medium reasoning, strict schema |
| Journey synthesis and ordering | Balanced model, medium reasoning on compact context |

For local Codex:

- Configure model and reasoning effort explicitly.
- Pass the SDK output schema rather than relying only on “return JSON” prompting.
- Use read-only/no-network execution and prevent unnecessary tool use.
- Reuse a `Codex` client object; benchmark whether bounded thread reuse is beneficial without contaminating independent results.
- Abort timed-out turns through an `AbortSignal`, ensuring subprocess cleanup.

For direct API mode:

- Use strict structured outputs.
- Set model and reasoning effort per workload.
- Record usage and cached-input tokens.
- Evaluate batch/offline execution as an optional full-repository mode, not as the interactive preview path.

**Acceptance criteria**

- Every provider event records its concrete model and reasoning effort.
- Extraction quality meets the evidence-coverage benchmark at the lower-latency profile.
- Invalid JSON/schema retries become exceptional rather than routine.
- No timed-out Codex subprocess continues consuming resources.

**Estimated impact:** 25–60% lower latency per model request, subject to evaluation.

## P5 — Make caching content-addressed and incremental

**Why high value:** After the first run, repository-scale reanalysis should be rare.

Introduce layered artifacts:

```text
Git blob or normalized file-content hash
  -> raw behavior extraction
  -> normalized contracts
  -> repository-specific deterministic edges
  -> ambiguous AI-resolved edges
  -> journeys and presentation
```

Key raw file extraction by:

- File content hash.
- Extraction prompt/schema version.
- Provider profile version.
- Relevant language/file-kind metadata.

Do not include repository line numbers or batch position in the semantic artifact identity. Reattach current file paths and line ranges during materialization. Keep separate versions for:

- Behavior extraction.
- Contract normalization.
- Ambiguous edge inference.
- Journey taxonomy/order.
- Display copy or visual layout.

On a new commit:

1. Reuse unchanged file artifacts.
2. Analyze changed files only.
3. Recompute deterministic edges touching changed contracts.
4. Invalidate only ambiguous subgraphs involving changed nodes.
5. Preserve unaffected journeys and user annotations.

**Acceptance criteria**

- A one-file edit does not analyze unrelated unchanged files.
- Moving an unchanged file can reuse its extraction artifact.
- Presentation-only prompt changes do not invalidate code extraction.
- Cache hit rate and avoided model calls are visible in job telemetry.

**Estimated impact:** 90%+ fewer model calls for typical incremental runs.

## P6 — Reduce semantic payload and redundant detail

**Why:** The baseline produced 2,048 nodes for 299 files. Large output schemas and repeated prose increase latency, token usage, graph density, and subsequent connection context.

Improvements to evaluate:

- Extract concise structured facts first; generate readable bullet copy lazily or only for visible nodes.
- Avoid requiring 60–140 words for every behavior during the bulk pass.
- Separate exact facts—trigger, actions, branches, collaborators, effects, errors—from rendered prose.
- Set a behavior budget based on meaningful code boundaries rather than a fixed 8–24 behaviors per request.
- Exclude generated artifacts, snapshots, vendored code, and optionally docs/tests through repository policy while making exclusions visible.
- Detect very large data/config files and use purpose-specific summarization.

Example compact internal representation:

```json
{
  "identity": "CatalogProcessor.__init__",
  "trigger": "worker constructs the processor",
  "actions": ["stores database and storage collaborators"],
  "branches": [],
  "effects": ["sets a 300-second lease"],
  "errors": [],
  "lineIds": ["..."]
}
```

The UI can render these facts as bullets without paying model-output cost for repetitive formatting.

**Acceptance criteria**

- Evidence ownership remains complete.
- Average output tokens per source line fall substantially.
- Node count reflects meaningful behaviors rather than prompt-imposed quotas.
- Human evaluation finds compact rendered nodes at least as understandable as current prose.

**Estimated impact:** 20–50% lower extraction token/time cost and a smaller integration graph.

## Recommended implementation sequence

### Milestone 1 — Measurement and honest progress

- Implement P0 telemetry.
- Pre-split and count leaf units without changing provider behavior.
- Add a reproducible benchmark command and baseline report.

This milestone should not intentionally change output quality.

### Milestone 2 — Remove avoidable connection calls

- Implement normalized contract indexing.
- Emit deterministic edges with provenance.
- Restrict AI integration to unresolved candidates.
- Evaluate edge precision/recall against a curated Cierge sample.

This is expected to be the largest low-risk wall-time reduction.

### Milestone 3 — Improve scheduling and provider latency

- Flatten the global leaf queue.
- Benchmark concurrency levels.
- Add explicit provider profiles and schemas.
- Add real cancellation and retry classification.

### Milestone 4 — Progressive architecture-first experience

- Produce an early HLD preview.
- Support priority analysis from user selection.
- Refine preview nodes in place.

### Milestone 5 — Incremental repository intelligence

- Introduce content-addressed file artifacts.
- Add dependency-aware invalidation.
- Decouple extraction, relationships, taxonomy, and presentation versions.

### Milestone 6 — Compact semantic representation

- Benchmark structured facts against long generated bullets.
- Lazy-render detail.
- Tune repository inclusion policies.

## Evaluation design

### Benchmark repositories

Use at least:

- `cierge-dev`: mixed frontend/backend/infrastructure and the current reference case.
- A small repository: validates overhead and time-to-first-result.
- A large repository in another language family: validates language independence.

Freeze exact repository snapshots by commit plus dirty-tree content hash.

### Performance metrics

- Time to inventory, architecture preview, selected subsystem, and full completion.
- Provider request count by phase.
- P50/P95 request latency and queue delay.
- Input, cached-input, reasoning, and output tokens.
- Retry, timeout, invalid-output, and split rates.
- Peak memory and active Codex subprocesses.
- Cold-cache and warm-cache performance.

### Quality metrics

Create a manually reviewed golden set containing:

- Source-line ownership.
- Functions/classes/sections represented.
- Fallbacks, errors, retries, configuration, and state effects.
- Frontend-to-backend contracts.
- Backend-to-database/storage/queue/external-system paths.
- Invalid edges and duplicate edges.
- Journey separation and ordering.

Track:

- Line coverage.
- Behavior precision and recall.
- Edge precision and recall by origin.
- Journey completeness.
- Evidence attribution accuracy.
- Human time to answer representative code-understanding questions.

No optimization should ship based only on wall-clock time.

## Experiments and decision gates

| Experiment | Variants | Decision gate |
| --- | --- | --- |
| Leaf concurrency | 4 / 6 / 8 workers | Best wall time without >5% retry increase |
| Extraction reasoning | none/minimal / low / medium | Use low by default; escalate only failed focused repair to medium |
| Extraction representation | generated bullets / structured facts | Preserve comprehension and evidence coverage |
| Deterministic connections | exact only / exact + normalized | Edge precision >= agreed threshold |
| Ambiguous candidate size | 16 / 32 / 48 nodes | Best recall per model call |
| Architecture preview | manifest only / high-signal excerpts | Useful HLD within time budget |

## Risks and mitigations

### Faster extraction loses subtle behavior

Mitigation: maintain an evidence-coverage golden set and selectively escalate low-confidence or high-risk files to a stronger profile.

### Deterministic matching creates false edges

Mitigation: require typed contract families and compatible direction; show origin/evidence; never match on generic symbol text alone.

### Increased concurrency causes throttling or instability

Mitigation: provider-specific adaptive concurrency, jittered retry, and circuit breaking based on telemetry.

### Progressive nodes jump or change identity

Mitigation: stable identities derived from repository, file content, and named boundary; explicit replacement mapping when preview nodes refine.

### Cache reuse attaches stale line evidence

Mitigation: cache semantic facts by content but recompute current line mappings and verify every attributed snippet against the active file hash.

## Explicit non-goals for the first optimization pass

- Do not add AST, compiler, parser, or LSP dependencies.
- Do not sacrifice every-line accountability.
- Do not solve performance by silently excluding repository areas.
- Do not merely increase timeouts.
- Do not treat more workers as the primary architectural fix.
- Do not couple layout/UI optimization to semantic pipeline optimization.

## Recommended first implementation slice

The highest-value initial slice is:

1. Add request-level telemetry and a benchmark report.
2. Pre-split into a truthful global leaf queue.
3. Build exact deterministic contract edges.
4. Send only unresolved connection candidates to AI.
5. Configure a low-reasoning, structured-output extraction profile.

This slice addresses all three dominant costs—hidden serial work, excessive connection calls, and expensive default agent execution—while keeping the current semantic model and UI contract largely intact.

For the `cierge-dev` baseline, the initial target is to reduce approximately 254 model calls to fewer than 190 before caching, cut the connection phase to under 30 minutes, and produce a meaningful architecture preview within 10 minutes. Subsequent content-addressed caching should make normal incremental runs require only a small fraction of those calls.
