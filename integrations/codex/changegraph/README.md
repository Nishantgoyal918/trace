# ChangeGraph for Codex

This repo-local plugin connects Codex to the ChangeGraph local service and dashboard.

- `changegraph_index_repository` starts a cached parallel baseline map.
- `changegraph_review_diff` explains the current Git diff against existing-code context.
- `changegraph_job_status` reports progress without copying the complete graph into chat.
- `changegraph_open_dashboard` returns the live graph URL.

Start the local dashboard and ChangeGraph service from the repository before loading the plugin during development.

