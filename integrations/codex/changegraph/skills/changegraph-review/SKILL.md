---
name: changegraph-review
description: Build or refresh a live ChangeGraph map when the user wants to understand an existing repository, inspect AI-generated code, or review every behavior change in a Git diff.
---

# ChangeGraph review

Use the ChangeGraph MCP tools as the persistent visual companion to code work.

## Existing repository

1. Call `changegraph_index_repository` with the repository root and the user's actual objective.
2. Give the user the returned dashboard URL immediately. The local service performs file-preserving work in parallel, so do not serialize or recreate its work units in the main conversation.
3. Continue useful repository work while the index runs. Check `changegraph_job_status` only when the user asks or when the map is needed for the next decision.
4. Treat low-confidence and unknown nodes as explicit review items; never hide them.

## Code changes

1. After an implementation or before approval, call `changegraph_review_diff` with the repository root and original task.
2. Ensure the graph explains exact before-to-after behavior, including fallbacks, error routes, state, configuration, outputs, and tests.
3. Return the dashboard URL and summarize only the most consequential concepts in chat. Keep exact line evidence in the dashboard.

## Continuity

- Reuse existing jobs and cached file results when content has not changed.
- Do not claim complete coverage until the job reports `complete`.
- Do not silently switch AI providers.
- The local service and web dashboard are the source of truth for graph state; this skill is the orchestration adapter.

