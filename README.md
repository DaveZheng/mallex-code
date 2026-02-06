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
- Python 3.10+ with `mlx-lm` installed (`pip install mlx-lm`)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- Node.js 18+

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

Claude Code sends massive system prompts designed for Claude (Opus/Sonnet). Most of this is useless or harmful for small local models — it burns prefill time and confuses the model.

mallex categorizes models by parameter count and trims accordingly:

| Tier | Params | Max Input Budget | Strategy |
|---|---|---|---|
| Small | ≤8B | ~14K chars (~4K tokens) | Replace system prompt, strip message overhead |
| Medium | 9-32B | ~7K chars (~2K tokens) | Moderate system prompt, strip message overhead |
| Large | >32B | ~1.8K chars (~500 tokens) | Keep more context, still strip infrastructure noise |

Budgets target ~8s prefill on M3 Max class hardware. On base M1/M2 (no Pro/Max), effective budgets are roughly half.

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
