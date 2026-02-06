# Source Cleanup Plan

Cleanup of files migrated from the standalone CLI that are no longer needed under the translation proxy architecture.

## Files to Delete

| File | Reason |
|------|--------|
| `src/repl.ts` | Claude Code is the UI — we don't need our own REPL |
| `src/index.ts` | Old CLI entry point for the REPL — needs full rewrite as proxy server |

## Files to Refactor

| File | What Changes |
|------|-------------|
| `src/tools.ts` | Keep `TOOL_DEFINITIONS` array (needed for prompt injection). Remove `executeTool()` and all tool executor functions (`readFile`, `writeFile`, `editFile`, `bash`, `globFiles`, `grepFiles`) — Claude Code runs tools, not us. Rename to `src/tool-definitions.ts`. |
| `src/tools.test.ts` | Remove executor tests. Keep `TOOL_DEFINITIONS` tests. Rename to `src/tool-definitions.test.ts`. |
| `src/client.ts` | Currently calls mlx-lm.server directly. Refactor to be used by the proxy server — accept parsed request, return parsed response. May split into `src/mlx-client.ts` (outbound to mlx-lm.server) and `src/proxy-server.ts` (inbound from Claude Code). |
| `src/client.test.ts` | Update to match refactored client. |
| `src/prompt.ts` | Currently builds a Mallex-specific system prompt. Refactor to only handle tool definition injection — take Claude Code's system prompt and append tool definitions in XML format. |
| `src/prompt.test.ts` | Update to match refactored prompt builder. |
| `src/e2e.test.ts` | Rework to test the proxy: send an Anthropic-format request to the proxy, verify it returns a valid Anthropic-format response with tool_use blocks. |

## Files to Keep As-Is

| File | Reason |
|------|--------|
| `src/config.ts` | Still loads `~/.mallex/config.json` — add `proxyPort` field |
| `src/config.test.ts` | Still valid |
| `src/device.ts` | Still inspects chip/RAM for model recommendation |
| `src/device.test.ts` | Still valid |
| `src/server.ts` | Still manages mlx-lm.server lifecycle |
| `src/server.test.ts` | Still valid |
| `src/parser.ts` | Core of the proxy — parses XML tool calls from model output |
| `src/parser.test.ts` | Still valid |

## New Files to Create

| File | Purpose |
|------|---------|
| `src/index.ts` | New entry point — starts the translation proxy HTTP server |
| `src/proxy.ts` | HTTP server that accepts Anthropic Messages API requests |
| `src/translate-request.ts` | Anthropic request -> OpenAI request conversion |
| `src/translate-response.ts` | OpenAI response -> Anthropic response conversion |
| `src/translate-stream.ts` | OpenAI SSE chunks -> Anthropic SSE events |
| `src/translate-request.test.ts` | Tests for request translation |
| `src/translate-response.test.ts` | Tests for response translation |
| `src/translate-stream.test.ts` | Tests for streaming translation |

## Execution Order

1. Delete `src/repl.ts`
2. Refactor `src/tools.ts` -> `src/tool-definitions.ts` (keep definitions, remove executor)
3. Refactor `src/prompt.ts` (tool injection only, no standalone system prompt)
4. Refactor `src/client.ts` (outbound mlx-lm.server client, no direct CLI usage)
5. Create new proxy files (`proxy.ts`, `translate-*.ts`)
6. Rewrite `src/index.ts` as proxy entry point
7. Rework `src/e2e.test.ts` to test the proxy
8. Update `package.json` scripts (`start` runs proxy, add `mallex-proxy` bin)
