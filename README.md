# ChangeGraph POC

ChangeGraph turns a unified diff into a semantic node-and-edge graph while preserving a deterministic ledger of every added and deleted line. Selecting a node reveals the exact old and new lines that it owns. Lines that the AI cannot safely classify remain visible in an `unknown` node.

The POC is language-agnostic by design: it uses the unified diff plus AI reasoning and does not depend on ASTs, compilers, parsers, LSPs, or Tree-sitter.

## Run the web app

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

POC demo mode is enabled by default and makes no external call.

## AI providers

### OpenAI API

Set `OPENAI_API_KEY` on the web server, optionally set `OPENAI_MODEL`, turn off POC demo mode, and select **OpenAI API**. The key stays server-side.

### Codex local

Install and authenticate Codex locally, then start the companion bridge in a second terminal:

```bash
npm run codex:bridge
```

Turn off POC demo mode and select **Codex local**. The browser calls the loopback-only bridge at `127.0.0.1:47831`, which uses the official Codex SDK and the user's local Codex authentication. If the bridge is unavailable, the app reports the failure and does not fall back to the OpenAI API.

## Validate

```bash
npm test
```
