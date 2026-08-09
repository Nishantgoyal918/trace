---
name: changegraph-review
description: Use when understanding an existing repository or reviewing AI-generated changes with exact line ownership, fallbacks, error paths, state, outputs, configuration, and tests.
---

# ChangeGraph review

For an existing repository, call `changegraph_index_repository` with the repository root and the user's objective. Share the live dashboard URL immediately while ChangeGraph processes file-preserving work units in parallel.

After changing code, call `changegraph_review_diff` with the repository root and original task. The dashboard is the source of truth for exact before-to-after explanations and line coverage.

Do not serialize the service's work units, start duplicate jobs for unchanged content, hide unknown nodes, or claim complete coverage until the job reports `complete`. Never silently switch providers.

