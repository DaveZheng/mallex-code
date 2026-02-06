# Mallex Code — Design Document

A translation proxy that lets Claude Code run against local MLX models on Apple Silicon.

## Overview

Instead of rebuilding the Claude Code UI from scratch, Mallex Code is a lightweight HTTP proxy that sits between Claude Code and `mlx-lm.server`. Claude Code sends Anthropic Messages API requests; the proxy translates them to OpenAI chat completions format for `mlx-lm.server`, and translates responses back — including tool use via prompt engineering and XML parsing.

The result: the full Claude Code experience (Ink/React terminal UI, spinners, tool rendering, permissions, streaming) running against a local MLX model with zero cloud API calls.

### Architecture

```
Claude Code  ──Anthropic Messages API──>  [mallex-proxy :3456]  ──OpenAI Chat Completions──>  mlx-lm.server :8080
             <──Anthropic SSE events────                        <──OpenAI SSE chunks─────
```

### Usage

```bash
# Terminal 1: start mlx-lm server (or let mallex-proxy auto-start it)
source .venv/bin/activate && python3 -m mlx_lm.server --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit --port 8080

# Terminal 2: start the proxy
mallex-proxy

# Terminal 3: run Claude Code pointed at the proxy
ANTHROPIC_BASE_URL=http://localhost:3456 ANTHROPIC_AUTH_TOKEN=local claude
```

Or, with a convenience wrapper:

```bash
mallex  # starts proxy + server if needed, launches claude with env vars set
```

## Key Components

1. **Translation proxy** (`mallex-proxy`) — HTTP server accepting Anthropic Messages API, translating to/from OpenAI format
2. **Device inspector** — reads Apple Silicon chip/RAM, recommends MLX model
3. **Server manager** — auto-starts/connects to `mlx-lm.server`, health checks, idle shutdown
4. **Config** — `~/.mallex/config.json` for model, ports, preferences

## Translation Proxy

The proxy implements a subset of the Anthropic Messages API — specifically `POST /v1/messages` — sufficient for Claude Code to function.

### Request Translation (Anthropic -> OpenAI)

Claude Code sends requests like:

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 8192,
  "system": "You are a coding assistant...",
  "messages": [
    {"role": "user", "content": "Read the file src/index.ts"},
    {"role": "assistant", "content": [
      {"type": "text", "text": "Let me read that."},
      {"type": "tool_use", "id": "call_1", "name": "Read", "input": {"file_path": "src/index.ts"}}
    ]},
    {"role": "user", "content": [
      {"type": "tool_result", "tool_use_id": "call_1", "content": "file contents..."}
    ]}
  ],
  "tools": [
    {"name": "Read", "description": "Read a file", "input_schema": {...}},
    ...
  ],
  "stream": true
}
```

The proxy transforms this to:

```json
{
  "model": "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
  "max_tokens": 8192,
  "temperature": 0.7,
  "stream": true,
  "messages": [
    {"role": "system", "content": "[system prompt + injected tool definitions in XML format]"},
    {"role": "user", "content": "Read the file src/index.ts"},
    {"role": "assistant", "content": "Let me read that.\n<tool_call>\n<function=Read>\n<parameter=file_path>src/index.ts</parameter>\n</function>\n</tool_call>"},
    {"role": "user", "content": "Tool result for Read (call_1):\nfile contents..."}
  ]
}
```

Key transformations:
- **Model mapping**: Ignore Claude model ID, use configured MLX model
- **System prompt**: Merge Anthropic `system` field with injected tool definitions
- **Tool definitions**: Convert from Anthropic `tools` array (JSON Schema) to XML format in system prompt
- **Content blocks**: Flatten Anthropic content block arrays (`tool_use`, `tool_result`, `text`) into plain text messages with XML tool call formatting
- **Tool use history**: Convert prior `tool_use` blocks back to XML format so the model sees consistent conversation history

### Response Translation (OpenAI -> Anthropic)

The model outputs plain text that may contain XML tool calls:

```
Let me read that file for you.

<tool_call>
<function=Read>
<parameter=file_path>src/index.ts</parameter>
</function>
</tool_call>
```

The proxy parses this and returns Anthropic format:

```json
{
  "id": "msg_local_123",
  "type": "message",
  "role": "assistant",
  "content": [
    {"type": "text", "text": "Let me read that file for you."},
    {"type": "tool_use", "id": "toolu_1", "name": "Read", "input": {"file_path": "src/index.ts"}}
  ],
  "model": "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
  "stop_reason": "tool_use",
  "usage": {"input_tokens": 0, "output_tokens": 0}
}
```

If no tool calls are found, `stop_reason` is `"end_turn"`.

### Streaming Translation

Claude Code uses Anthropic SSE streaming. The proxy translates OpenAI streaming chunks to Anthropic streaming events.

**Anthropic streaming event sequence:**

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"...","stop_reason":null,"usage":{"input_tokens":N,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" read that."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\":\"src/index.ts\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":N}}

event: message_stop
data: {"type":"message_stop"}
```

**Strategy:** Buffer OpenAI stream chunks and accumulate text. Stream text deltas to Claude Code in real time. When the stream ends, parse the accumulated text for tool calls. If tool calls are found, emit the `tool_use` content blocks and set `stop_reason: "tool_use"`. This means tool calls appear after text streaming completes — acceptable UX since tool calls are fast to emit once parsed.

### Tool Definition Translation

Claude Code sends Anthropic-format tool definitions:

```json
{
  "name": "Read",
  "description": "Read a file",
  "input_schema": {
    "type": "object",
    "properties": {
      "file_path": {"type": "string", "description": "Absolute path"}
    },
    "required": ["file_path"]
  }
}
```

The proxy converts these to the XML system prompt format that Qwen3-Coder understands, using the same approach as our existing `prompt.ts`.

### Parser Robustness

Uses our existing `parser.ts` which handles known Qwen model quirks:
- Missing `<tool_call>` opening tag
- Missing `</tool_call>` closing tag
- Bare `<function=...>` without wrapper tags
- Leaked `<|im_end|>` / `<|im_start|>` tokens

## Device Inspector & Model Recommendation

Unchanged from original design. On first run, inspects chip/RAM and recommends a model.

| Total RAM | Recommended Model | Size |
|-----------|-------------------|------|
| 8GB | Qwen2.5-Coder-7B-Instruct-4bit | 4.0 GB |
| 16GB | Qwen2.5-Coder-14B-Instruct-4bit | 7.7 GB |
| 32GB | Qwen3-Coder-30B-A3B-Instruct-4bit | 16.0 GB |
| 64GB | Qwen3-Coder-Next-4bit | 41.8 GB |
| 128GB+ | Qwen3-Coder-Next-8bit | 78.9 GB |

## Server Manager

Manages the `mlx-lm.server` lifecycle:
- Auto-start on first proxy request if not running
- Health check via `/v1/models`
- PID tracking in `~/.mallex/server.pid`
- Idle shutdown after 30min (configurable)
- Python venv at project `.venv/` — never install into system Python

## Configuration

`~/.mallex/config.json`:

```json
{
  "model": "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
  "serverPort": 8080,
  "proxyPort": 3456,
  "idleTimeoutMinutes": 30
}
```

## What Claude Code Handles (Not Our Problem)

- Terminal UI (Ink/React), spinners, markdown rendering
- Tool execution (Read, Write, Edit, Bash, Glob, Grep)
- Permission model and user approval prompts
- Conversation history management
- Slash commands, plugins, MCP
- Git workflows, PR creation

## Limitations

- **No extended thinking** — local models don't support `thinking` blocks; proxy strips/ignores them
- **No image/PDF** — text-only; proxy rejects or strips image content blocks
- **Model quality** — Qwen 7B following Claude Code prompts (designed for Claude) may behave differently
- **Tool call reliability** — local models may produce malformed tool calls more often than Claude; parser handles common cases but edge cases will surface
- **Token counting** — proxy reports approximate/zero token counts since mlx-lm.server token counting differs from Anthropic's
