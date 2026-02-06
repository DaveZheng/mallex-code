# Mallex Code — Design Document

A local-first CLI coding assistant that runs MLX models on Apple Silicon, replicating the core Claude Code experience without API calls.

## Overview

User types `mallex`, gets an interactive terminal session with full file/shell tool access powered by a local MLX model. No API keys, no cloud dependency, no data leaving the machine.

### Core Flow

```
User runs `mallex`
  -> CLI checks device specs (chip, total RAM)
  -> Recommends/downloads an MLX model from HuggingFace
  -> Auto-starts mlx-lm.server on localhost if not already running
  -> Opens interactive terminal session
  -> User prompt -> MLX model -> tool calls -> execute -> response
  -> Server persists across sessions; idle timeout shuts it down
```

### Key Components

1. **CLI entry point** (`mallex`) — TypeScript/Node, handles setup, REPL loop, rendering
2. **Device inspector** — reads Apple Silicon chip type, total RAM, recommends model
3. **Model manager** — downloads MLX models from HuggingFace, manages local cache
4. **Server manager** — auto-starts/connects to `mlx-lm.server`, health checks, lifecycle
5. **API translation layer** — translates between Anthropic tool-use format (which the CLI internals use) and OpenAI function-calling format (which `mlx-lm.server` speaks)
6. **Tool executor** — Read, Write, Edit, Bash, Glob, Grep

## Device Inspector & Model Recommendation

On first run (or `mallex --setup`), the CLI inspects the machine and recommends a model.

**Usable budget = Total RAM x 0.75** (reserve 25% for OS + apps). Uses total RAM, not available — available fluctuates based on open apps and is unreliable for a stable recommendation.

**Note:** MoE models (like 30B-A3B) require ALL weights in memory for routing, not just active params. A 30B MoE at 4-bit is ~16GB, not ~5GB.

### Recommendation Table

| Total RAM | Model Budget | Recommended Model | Actual Size | Notes |
|-----------|-------------|-------------------|-------------|-------|
| 8GB | ~6GB | Qwen2.5-Coder-7B (4-bit) | 4.0 GB | Best coding model that fits |
| 16GB | ~12GB | Qwen2.5-Coder-14B (4-bit) | 7.7 GB | Strongest coder under 12GB |
| 32GB | ~24GB | Qwen3-Coder-30B-A3B (4-bit) | 16.0 GB | MoE, first Qwen3-Coder tier |
| 64GB | ~48GB | Qwen3-Coder-Next (4-bit) | 41.8 GB | Best coding model, 256k context |
| 128GB+ | ~96GB+ | Qwen3-Coder-Next (8-bit) | 78.9 GB | Full quality |

**Important:** This table will go stale. The recommendation logic should pull a curated model list from a remote manifest or bundled config file, so it can be updated without shipping a new CLI version.

### User Choices

The CLI presents the recommendation but always lets the user:
- Accept the recommendation
- Pick from a curated list of known-good coding models
- Enter any MLX model ID from HuggingFace manually (e.g., `mlx-community/Qwen3-Coder-Next-4bit`)

### Configuration

Model config stored in `~/.mallex/config.json`:

```json
{
  "model": "mlx-community/Qwen3-Coder-Next-4bit",
  "serverPort": 8080,
  "idleTimeoutMinutes": 30
}
```

Models are downloaded on first use via `huggingface-hub` (Python dependency) and cached in the standard HuggingFace cache dir (`~/.cache/huggingface/`).

## Server Manager

Uses `mlx-lm.server` for local inference. It provides an OpenAI-compatible chat completions endpoint but does NOT support function calling natively. That's fine — our translation layer handles tool use entirely: we inject tool definitions into the prompt, the model generates structured output, and we parse it ourselves. No third-party wrappers needed. Speed gains come from MLX itself (unified memory, Metal kernels), not the serving layer.

### Auto-Start Flow

1. CLI checks `localhost:{port}/v1/models` for a running server
2. If running -> verify it's serving the expected model, connect
3. If not -> spawn `mlx-lm.server` with the configured model and port as a detached child process
4. Write PID to `~/.mallex/server.pid`
5. Poll health endpoint until ready (timeout after 120s for large models)
6. Connect

### Cold Start

Model loading takes ~30s+ depending on model size. This is unavoidable with MLX.

Mitigations:
- Server persists across CLI sessions (30s load happens once)
- First run shows a progress indicator during model download + load
- `mallex server start` lets users pre-warm before working

### Idle Shutdown

The server gracefully shuts down after 30 minutes of inactivity (configurable). A 30s cold start on next use is preferred over silently consuming 75% of RAM when the user has forgotten about it.

- Server tracks last request timestamp
- After idle timeout expires, server shuts down and frees RAM
- CLI shows a brief "Starting model..." spinner on next cold start
- `mallex server keep-alive` for users who explicitly want persistent server

### Manual Control

- `mallex server start` — explicitly start the server
- `mallex server stop` — kill the server and free RAM
- `mallex server status` — show running model, port, memory usage

### Python Dependency

`mlx-lm` is a Python package. The CLI will check for it and prompt installation (`pip install mlx-lm`) on first run, or bundle a minimal Python venv.

## API Translation Layer

`mlx-lm.server` provides an OpenAI-compatible chat completions endpoint but does NOT support function calling. We handle tool use entirely via prompt engineering and output parsing — no third-party wrappers.

### Approach: Prompt-Based Tool Use with Qwen3-Coder Native Format

Qwen3-Coder models natively express tool calls using XML tags:

```xml
<tool_call>
<function=read_file>
<parameter=file_path>/src/main.ts</parameter>
</function>
</tool_call>
```

Our translation layer:
1. Injects tool definitions into the system prompt describing available tools and the expected XML format
2. Sends plain chat completions requests to `mlx-lm.server` (no `tools` parameter)
3. Parses `<tool_call>` blocks from the model's text output
4. Converts parsed tool calls into internal Anthropic-format `tool_use` content blocks
5. Feeds tool results back as messages the model can consume

### System Prompt Tool Injection

Tools are described in the system prompt with their schemas and the exact output format expected:

```
You have access to the following tools. To use a tool, output a tool_call block:

<tool_call>
<function=tool_name>
<parameter=param_name>value</parameter>
</function>
</tool_call>

Available tools:

- read_file: Read file contents with line numbers
  Parameters: file_path (string, required), offset (number), limit (number)

- write_file: Create or overwrite a file
  Parameters: file_path (string, required), content (string, required)

[...etc for each tool]
```

### Output Parsing

The parser extracts `<tool_call>` blocks from model output. It must handle:
- Clean output: text followed by one or more `<tool_call>` blocks
- Missing opening tag: known Qwen3-Coder issue where `<tool_call>` is dropped after text (see github.com/QwenLM/Qwen3-Coder/issues/475). Fallback: detect `<function=` without a preceding `<tool_call>` and treat it as a tool call anyway.
- Multiple tool calls in one response
- Malformed parameters: retry with a nudge prompt if parsing fails

### Internal Format

Internally, parsed tool calls are represented as Anthropic-style content blocks:

```
{
  role: "assistant",
  content: [
    { type: "text", text: "Let me read that file." },
    { type: "tool_use", id: "call_1", name: "read_file", input: { file_path: "/src/main.ts" } }
  ]
}
```

Tool results are fed back as:

```
{
  role: "user",
  content: [
    { type: "tool_result", tool_use_id: "call_1", content: "1  import foo from 'bar';\n..." }
  ]
}
```

These get serialized into plain text messages when sent to `mlx-lm.server`.

### Skipped in v1

- Extended thinking / `thinking` blocks — no local model equivalent
- Streaming — start with synchronous request/response, add streaming later
- Image/PDF content blocks — text-only for v1

## Tool Executor & REPL Loop

### Core Tools (v1)

| Tool | Description |
|------|-------------|
| `Read` | Read file contents with line numbers |
| `Write` | Create/overwrite files |
| `Edit` | String replacement in files (old_string -> new_string) |
| `Bash` | Execute shell commands with timeout |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents with regex |

Each tool has a JSON Schema definition that gets sent to the model as a tool definition. The model returns `tool_use` blocks, the executor runs them, and results go back as `tool_result`.

### REPL Loop

```
1. User types input
2. Build messages array (system prompt + conversation history)
3. Send to mlx-lm.server via OpenAI-format request (translated)
4. Receive response (translated back to Anthropic format)
5. If stop_reason is "tool_use":
   a. Display tool call to user (with approval if needed)
   b. Execute tool
   c. Append tool_use + tool_result to conversation
   d. Go to step 3
6. If stop_reason is "end_turn":
   a. Display text response
   b. Go to step 1
```

### System Prompt

A simplified version of Claude Code's system prompt, adapted to not reference Anthropic-specific features. Tells the model what tools are available, how to use them, and basic coding assistant behavior.

### Permission Model (v1 — simplified)

- File read/glob/grep: always allowed
- File write/edit: always allowed (user's local machine)
- Bash: prompt user for approval before executing

## Roadmap (Post-v1)

- **Streaming responses** — stream tokens as they arrive for better UX
- **Plugin system** — load plugins from `plugins/` directory (commands, agents, skills, hooks)
- **MCP server support** — connect to external tool servers
- **IDE extensions** — VS Code integration
