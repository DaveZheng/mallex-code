# mallex

Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) against local MLX models on Apple Silicon.

mallex is a translation proxy that sits between Claude Code and [mlx-lm.server](https://github.com/ml-explore/mlx-lm), converting Anthropic Messages API requests to OpenAI Chat Completions format.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/nicobailon/mallex-code/main/install.sh | bash
```

Or build from source:

```bash
git clone https://github.com/nicobailon/mallex-code.git
cd mallex-code
npm install && npm run build
npm link
```

## Prerequisites

- macOS with Apple Silicon (M1/M2/M3/M4)
- Python 3.10+ (mallex auto-creates a venv and installs `mlx-lm` on first run)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed

## Usage

```bash
# Launch Claude Code with a local model (auto-starts mlx-lm.server)
mallex

# Start proxy only (for use with an existing Claude Code session)
mallex proxy

# Stop the background mlx-lm.server
mallex server stop
```

On first run, mallex detects your hardware and recommends a model. You can accept the recommendation or provide a custom model ID.

## How It Works

```
Claude Code  →  mallex proxy (localhost:3456)  →  mlx-lm.server (localhost:8080)
 Anthropic        translates request/response        OpenAI Chat Completions
 Messages API     trims prompts for model size        serves local MLX model
```

1. **Starts mlx-lm.server** with your chosen model if not already running
2. **Translates requests** from Anthropic Messages API → OpenAI Chat Completions
3. **Trims prompts** — Claude Code sends ~24K chars of system prompt overhead; mallex trims this to fit the model's practical context budget
4. **Injects tool definitions** as XML in the system prompt so the local model can use tools (read_file, write_file, edit_file, bash, glob, grep)
5. **Translates responses** back from OpenAI format → Anthropic format (including streaming)

## Prompt Trimming

### The problem

Claude Code sends **~24K characters** of prompt overhead with every request — even for "what is 2+2". This prompt is designed for Claude (Opus/Sonnet with 200K context windows), but local models on Apple Silicon need to process every token through prefill before generating a single response token.

A 7B model on an M3 Max processes prefill at ~700 tokens/sec. At ~3.5 chars/token, 24K chars = ~6,800 tokens = **~10 seconds** of staring at a spinner before the model starts responding. For a simple question.

### What Claude Code actually sends

Every request includes two layers of overhead:

**System prompt (~15K chars)** — the `system` field:
- Claude Code identity and Anthropic safety rules
- Detailed behavioral instructions (over-engineering warnings, reversibility analysis, etc.)
- Tool usage instructions referencing Claude Code's native tools (Read, Edit, Glob, etc.)
- Git commit/PR creation workflows with templates
- Tone/style guidelines
- Auto-memory system instructions
- Environment context (working directory, platform, git branch)
- User's CLAUDE.md / MEMORY.md project instructions
- Git status snapshot with recent commits

**User message blocks (~9K chars)** — injected as `<system-reminder>` content blocks in the first user message:
- Startup hook confirmations
- Skill system meta-instructions (4K chars explaining how to invoke skills)
- 18 skill definitions (3.3K chars the model can't use — no `/slash-command` system exists locally)
- Duplicate MEMORY.md content (already in system prompt)
- The actual user question (16 chars)

Plus **22 tool definitions** as JSON schemas in the `tools` field.

### The solution

mallex trims at two levels, applied during request translation before forwarding to the local model:

**1. System prompt replacement** (`trimSystemPrompt`) — categorizes models by parameter count into tiers, then replaces Claude Code's verbose system prompt with a compact equivalent while preserving what matters:

| Tier | Params | Strategy |
|---|---|---|
| Small | ≤8B | Replace entirely with minimal coding assistant prompt. Extract and keep environment info + user's CLAUDE.md instructions. |
| Medium | 9-32B | Replace with moderate prompt including core coding rules. Keep environment + user instructions. |
| Large | >32B | Pass through (these models can handle it, though they're slow regardless). |

**2. Message block filtering** (`trimMessages`) — strips Claude Code infrastructure from user message content blocks using pattern matching:

| Priority | What gets stripped | Chars saved | Why |
|---|---|---|---|
| 1 | Skills listing (18 skill descriptions) | ~3,300 | Local model has no skill/slash-command system |
| 2 | Superpowers meta-instructions | ~4,090 | Instructions for invoking skills that don't exist locally |
| 3 | Session hook confirmations | ~79 | Infrastructure artifacts with no semantic value |
| 4 | Duplicate MEMORY.md | ~1,064 | Already preserved in the trimmed system prompt |
| 5 | Task tool reminders | ~200 | Periodic nudges from Claude Code's task system |

Unrecognized `<system-reminder>` blocks are unwrapped (tags stripped, content kept) rather than dropped, so new Claude Code features degrade gracefully.

**3. Tool injection** — Claude Code's 22 JSON tool schemas are dropped entirely. mallex injects its own 6 tools as XML in the system prompt, using a format local models can parse:

```xml
<tool name="read_file">
  <description>Read file contents with line numbers</description>
  <parameter name="file_path" type="string" required="true">Absolute path to the file</parameter>
</tool>
```

### Result

For a simple question like "what is 2+2":

| | Before trimming | After trimming |
|---|---|---|
| System prompt | ~15K chars | ~500 chars + ~1K tool XML |
| User messages | ~9K chars | ~16 chars (just the question) |
| **Total** | **~24K chars (~6,800 tokens)** | **~1.5K chars (~430 tokens)** |
| **7B prefill time (M3 Max)** | **~10s** | **<1s** |

### Context budgets

Budgets are derived from prefill speed benchmarks, targeting **responsive interaction** (~8s max prefill on M3 Max class hardware, ~3.5 chars/token for mixed code and English):

| Tier | Params | Max Input Budget | Prefill speed (M3 Max, Q4) |
|---|---|---|---|
| Small | ≤8B | ~14K chars (~4K tokens) | ~680-760 t/s |
| Medium | 9-32B | ~7K chars (~2K tokens) | ~150-400 t/s |
| Large | >32B | ~1.8K chars (~500 tokens) | ~33-63 t/s |

On base M1/M2 (no Pro/Max), effective budgets are roughly half. On M4 Max / Ultra, they can be doubled.

## Configuration

Config is stored at `~/.mallex/config.json`:

```json
{
  "model": "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
  "serverPort": 8080,
  "proxyPort": 3456,
  "idleTimeoutMinutes": 15,
  "onExitServer": "ask"
}
```

## Recommended Models

| Hardware | Recommended Model | Notes |
|---|---|---|
| 16GB RAM | Qwen2.5-Coder-7B-Instruct-4bit | Best quality/speed for limited RAM |
| 32GB RAM | Qwen2.5-Coder-14B-Instruct-4bit | Good balance |
| 64GB+ RAM | Qwen2.5-Coder-32B-Instruct-4bit | Best local coding model |

## Debug

- Last raw request from Claude Code: `~/.mallex/last-request.json`
- mlx-lm.server logs: `~/.mallex/server.log`

## License

MIT
