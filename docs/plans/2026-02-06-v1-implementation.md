# Mallex Code v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working local CLI coding assistant that runs MLX models on Apple Silicon with tool use (Read, Write, Edit, Bash, Glob, Grep).

**Architecture:** TypeScript/Node CLI that auto-starts `mlx-lm.server` for inference, injects tool definitions via system prompt, parses Qwen3-Coder XML tool calls from model output, and executes tools in a REPL loop.

**Tech Stack:** TypeScript, Node.js 18+, `mlx-lm` (Python), `readline` for REPL, `node-fetch` for HTTP to local server.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `.gitignore` (update existing)

**Step 1: Initialize the Node project**

```json
// package.json
{
  "name": "mallex-code",
  "version": "0.1.0",
  "description": "Local-first CLI coding assistant powered by MLX",
  "type": "module",
  "bin": {
    "mallex": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "test": "node --test dist/**/*.test.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

**Step 2: Create minimal entry point**

```typescript
// src/index.ts
#!/usr/bin/env node
console.log("mallex v0.1.0");
```

**Step 3: Install dependencies, build, and verify**

Run: `npm install && npm run build && node dist/index.js`
Expected: Prints "mallex v0.1.0"

**Step 4: Update .gitignore**

Add `node_modules/`, `dist/` to `.gitignore`.

**Step 5: Commit**

```bash
git add package.json tsconfig.json src/index.ts .gitignore
git commit -m "feat: scaffold Node/TypeScript project"
```

---

### Task 2: Device Inspector

**Files:**
- Create: `src/device.ts`
- Create: `src/device.test.ts`

**Step 1: Write the failing test**

```typescript
// src/device.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { getDeviceInfo, recommendModel } from "./device.js";

describe("getDeviceInfo", () => {
  it("returns chip and totalMemoryGB on macOS", async () => {
    const info = await getDeviceInfo();
    assert.ok(info.chip, "chip should be a non-empty string");
    assert.ok(info.totalMemoryGB > 0, "totalMemoryGB should be positive");
  });
});

describe("recommendModel", () => {
  it("recommends small model for 8GB", () => {
    const rec = recommendModel(8);
    assert.ok(rec.modelId.includes("30B-A3B"));
    assert.ok(rec.quantization === "4bit");
  });

  it("recommends Coder-Next 4bit for 32GB", () => {
    const rec = recommendModel(32);
    assert.ok(rec.modelId.includes("Coder-Next"));
    assert.ok(rec.quantization === "4bit");
  });

  it("recommends Coder-Next 8bit for 64GB+", () => {
    const rec = recommendModel(64);
    assert.ok(rec.modelId.includes("Coder-Next"));
    assert.ok(rec.quantization === "8bit");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/device.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DeviceInfo {
  chip: string;
  totalMemoryGB: number;
}

export interface ModelRecommendation {
  modelId: string;
  quantization: string;
  estimatedSizeGB: number;
  description: string;
}

interface ModelTier {
  minRAM: number;
  modelId: string;
  quantization: string;
  estimatedSizeGB: number;
  description: string;
}

// Curated list — update this or pull from remote manifest
const MODEL_TIERS: ModelTier[] = [
  {
    minRAM: 64,
    modelId: "mlx-community/Qwen3-Coder-Next-8bit",
    quantization: "8bit",
    estimatedSizeGB: 46,
    description: "Qwen3-Coder-Next (8-bit) — full quality, 256k context",
  },
  {
    minRAM: 32,
    modelId: "mlx-community/Qwen3-Coder-Next-4bit",
    quantization: "4bit",
    estimatedSizeGB: 24,
    description: "Qwen3-Coder-Next (4-bit) — best coding model for the size",
  },
  {
    minRAM: 16,
    modelId: "mlx-community/Qwen3-Coder-30B-A3B-Instruct-8bit",
    quantization: "8bit",
    estimatedSizeGB: 10,
    description: "Qwen3-Coder-30B-A3B (8-bit) — higher quality quant",
  },
  {
    minRAM: 0,
    modelId: "mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit",
    quantization: "4bit",
    estimatedSizeGB: 5,
    description: "Qwen3-Coder-30B-A3B (4-bit) — compact MoE",
  },
];

export async function getDeviceInfo(): Promise<DeviceInfo> {
  const { stdout: chipOut } = await execFileAsync("sysctl", ["-n", "machdep.cpu.brand_string"]);
  const { stdout: memOut } = await execFileAsync("sysctl", ["-n", "hw.memsize"]);
  const totalBytes = parseInt(memOut.trim(), 10);

  return {
    chip: chipOut.trim(),
    totalMemoryGB: Math.round(totalBytes / (1024 ** 3)),
  };
}

export function recommendModel(totalMemoryGB: number): ModelRecommendation {
  const budget = totalMemoryGB * 0.75;
  for (const tier of MODEL_TIERS) {
    if (totalMemoryGB >= tier.minRAM && budget >= tier.estimatedSizeGB) {
      return tier;
    }
  }
  return MODEL_TIERS[MODEL_TIERS.length - 1];
}
```

**Step 4: Run tests**

Run: `npm run build && npm test`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/device.ts src/device.test.ts
git commit -m "feat: add device inspector and model recommendation"
```

---

### Task 3: Config Manager

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

**Step 1: Write the failing test**

```typescript
// src/config.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, DEFAULT_CONFIG, type MallexConfig } from "./config.js";

describe("config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mallex-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(tmpDir);
    assert.deepStrictEqual(config, DEFAULT_CONFIG);
  });

  it("saves and loads config", () => {
    const custom: MallexConfig = {
      model: "mlx-community/test-model-4bit",
      serverPort: 9090,
      idleTimeoutMinutes: 60,
    };
    saveConfig(custom, tmpDir);
    const loaded = loadConfig(tmpDir);
    assert.deepStrictEqual(loaded, custom);
  });

  it("merges partial config with defaults", () => {
    const partial = { model: "custom-model" };
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "config.json"), JSON.stringify(partial));
    const loaded = loadConfig(tmpDir);
    assert.strictEqual(loaded.model, "custom-model");
    assert.strictEqual(loaded.serverPort, DEFAULT_CONFIG.serverPort);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/config.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface MallexConfig {
  model: string;
  serverPort: number;
  idleTimeoutMinutes: number;
}

export const DEFAULT_CONFIG: MallexConfig = {
  model: "",
  serverPort: 8080,
  idleTimeoutMinutes: 30,
};

function configDir(baseDir?: string): string {
  return baseDir ?? path.join(os.homedir(), ".mallex");
}

export function loadConfig(baseDir?: string): MallexConfig {
  const dir = configDir(baseDir);
  const filePath = path.join(dir, "config.json");
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return { ...DEFAULT_CONFIG, ...raw };
}

export function saveConfig(config: MallexConfig, baseDir?: string): void {
  const dir = configDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
}
```

**Step 4: Run tests**

Run: `npm run build && npm test`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add config manager with ~/.mallex/config.json"
```

---

### Task 4: Server Manager

**Files:**
- Create: `src/server.ts`
- Create: `src/server.test.ts`

**Step 1: Write the failing test**

```typescript
// src/server.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildServerArgs, parseServerPid, isServerHealthy } from "./server.js";

describe("buildServerArgs", () => {
  it("builds correct mlx_lm.server command args", () => {
    const args = buildServerArgs("mlx-community/test-model", 8080);
    assert.deepStrictEqual(args, [
      "-m", "mlx_lm.server",
      "--model", "mlx-community/test-model",
      "--port", "8080",
    ]);
  });
});

describe("parseServerPid", () => {
  it("parses a valid PID file", () => {
    assert.strictEqual(parseServerPid("12345\n"), 12345);
  });

  it("returns null for empty content", () => {
    assert.strictEqual(parseServerPid(""), null);
  });

  it("returns null for non-numeric content", () => {
    assert.strictEqual(parseServerPid("not-a-pid"), null);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/server.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MALLEX_DIR = path.join(os.homedir(), ".mallex");
const PID_FILE = path.join(MALLEX_DIR, "server.pid");

export function buildServerArgs(model: string, port: number): string[] {
  return ["-m", "mlx_lm.server", "--model", model, "--port", String(port)];
}

export function parseServerPid(content: string): number | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const num = parseInt(trimmed, 10);
  return Number.isNaN(num) ? null : num;
}

export async function isServerHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/v1/models`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function startServer(model: string, port: number): Promise<number> {
  const args = buildServerArgs(model, port);
  const child = spawn("python3", args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const pid = child.pid;
  if (!pid) throw new Error("Failed to start mlx-lm server");

  fs.mkdirSync(MALLEX_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(pid) + "\n");

  return pid;
}

export async function waitForServer(port: number, timeoutMs: number = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerHealthy(port)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs / 1000}s`);
}

export async function ensureServer(model: string, port: number): Promise<void> {
  if (await isServerHealthy(port)) return;
  console.log("Starting MLX server...");
  await startServer(model, port);
  await waitForServer(port);
  console.log("Server ready.");
}

export function stopServer(): boolean {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = parseServerPid(fs.readFileSync(PID_FILE, "utf-8"));
  if (!pid) return false;
  try {
    process.kill(pid, "SIGTERM");
    fs.unlinkSync(PID_FILE);
    return true;
  } catch {
    fs.unlinkSync(PID_FILE);
    return false;
  }
}
```

**Step 4: Run tests**

Run: `npm run build && npm test`
Expected: All 3 tests PASS (unit tests only — no actual server started)

**Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: add server manager for mlx-lm.server lifecycle"
```

---

### Task 5: Tool Call Parser

This is the critical component — parsing Qwen3-Coder `<tool_call>` XML from model output.

**Files:**
- Create: `src/parser.ts`
- Create: `src/parser.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/parser.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseToolCalls, type ParsedToolCall } from "./parser.js";

describe("parseToolCalls", () => {
  it("parses a single tool call", () => {
    const output = `Let me read that file.

<tool_call>
<function=read_file>
<parameter=file_path>/src/main.ts</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.text, "Let me read that file.");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.deepStrictEqual(result.toolCalls[0].input, { file_path: "/src/main.ts" });
  });

  it("parses multiple parameters", () => {
    const output = `<tool_call>
<function=edit_file>
<parameter=file_path>/src/main.ts</parameter>
<parameter=old_string>const x = 1;</parameter>
<parameter=new_string>const x = 2;</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].name, "edit_file");
    assert.strictEqual(result.toolCalls[0].input.file_path, "/src/main.ts");
    assert.strictEqual(result.toolCalls[0].input.old_string, "const x = 1;");
    assert.strictEqual(result.toolCalls[0].input.new_string, "const x = 2;");
  });

  it("parses multi-line parameter values", () => {
    const output = `<tool_call>
<function=write_file>
<parameter=file_path>/test.ts</parameter>
<parameter=content>line one
line two
line three</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].input.content, "line one\nline two\nline three");
  });

  it("handles missing opening tool_call tag (known Qwen3 issue)", () => {
    const output = `I'll check that.
<function=read_file>
<parameter=file_path>/src/main.ts</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
  });

  it("parses multiple tool calls in one response", () => {
    const output = `<tool_call>
<function=read_file>
<parameter=file_path>/a.ts</parameter>
</function>
</tool_call>

<tool_call>
<function=read_file>
<parameter=file_path>/b.ts</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls.length, 2);
    assert.strictEqual(result.toolCalls[0].input.file_path, "/a.ts");
    assert.strictEqual(result.toolCalls[1].input.file_path, "/b.ts");
  });

  it("returns empty toolCalls for plain text", () => {
    const result = parseToolCalls("Just a normal response with no tool calls.");
    assert.strictEqual(result.toolCalls.length, 0);
    assert.strictEqual(result.text, "Just a normal response with no tool calls.");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/parser.ts

export interface ParsedToolCall {
  name: string;
  input: Record<string, string>;
}

export interface ParseResult {
  text: string;
  toolCalls: ParsedToolCall[];
}

export function parseToolCalls(output: string): ParseResult {
  const toolCalls: ParsedToolCall[] = [];

  // Normalize: handle missing <tool_call> tag (known Qwen3-Coder issue)
  // Insert <tool_call> before bare <function= if not preceded by <tool_call>
  let normalized = output.replace(
    /(?<!<tool_call>\s*)\n?(<function=)/g,
    "\n<tool_call>\n$1"
  );

  // Extract all tool call blocks
  const blockRegex = /<tool_call>\s*<function=([^>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  const textParts: string[] = [];

  // Collect text before first tool call
  const firstToolCall = normalized.search(/<tool_call>/);
  if (firstToolCall > 0) {
    textParts.push(normalized.slice(0, firstToolCall));
  } else if (firstToolCall === -1) {
    // No tool calls at all
    return { text: output.trim(), toolCalls: [] };
  }

  while ((match = blockRegex.exec(normalized)) !== null) {
    const name = match[1].trim();
    const body = match[2];
    const input: Record<string, string> = {};

    // Parse parameters
    const paramRegex = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      input[paramMatch[1].trim()] = paramMatch[2].trim();
    }

    toolCalls.push({ name, input });
  }

  const text = textParts.join("").trim();
  return { text, toolCalls };
}
```

**Step 4: Run tests**

Run: `npm run build && npm test`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/parser.ts src/parser.test.ts
git commit -m "feat: add tool call parser for Qwen3-Coder XML format"
```

---

### Task 6: Tool Definitions & Executor

**Files:**
- Create: `src/tools.ts`
- Create: `src/tools.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/tools.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";

describe("TOOL_DEFINITIONS", () => {
  it("includes all 6 core tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    assert.deepStrictEqual(names.sort(), [
      "bash", "edit_file", "glob", "grep", "read_file", "write_file",
    ].sort());
  });
});

describe("executeTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mallex-tools-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("read_file reads a file with line numbers", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "hello\nworld\n");
    const result = await executeTool("read_file", { file_path: filePath });
    assert.ok(result.includes("1\thello"));
    assert.ok(result.includes("2\tworld"));
  });

  it("write_file creates a file", async () => {
    const filePath = path.join(tmpDir, "new.txt");
    await executeTool("write_file", { file_path: filePath, content: "test content" });
    assert.strictEqual(fs.readFileSync(filePath, "utf-8"), "test content");
  });

  it("edit_file replaces string in file", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "foo bar baz");
    await executeTool("edit_file", {
      file_path: filePath,
      old_string: "bar",
      new_string: "qux",
    });
    assert.strictEqual(fs.readFileSync(filePath, "utf-8"), "foo qux baz");
  });

  it("glob finds files by pattern", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "c.js"), "");
    const result = await executeTool("glob", { pattern: "*.ts", path: tmpDir });
    assert.ok(result.includes("a.ts"));
    assert.ok(result.includes("b.ts"));
    assert.ok(!result.includes("c.js"));
  });

  it("grep searches file contents", async () => {
    fs.writeFileSync(path.join(tmpDir, "search.txt"), "line one\nfind me\nline three\n");
    const result = await executeTool("grep", { pattern: "find", path: tmpDir });
    assert.ok(result.includes("find me"));
  });

  it("bash executes a command", async () => {
    const result = await executeTool("bash", { command: "echo hello" });
    assert.ok(result.includes("hello"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/tools.ts
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read file contents with line numbers",
    parameters: {
      file_path: { type: "string", description: "Absolute path to the file", required: true },
      offset: { type: "number", description: "Line number to start from (1-based)" },
      limit: { type: "number", description: "Max lines to read" },
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file",
    parameters: {
      file_path: { type: "string", description: "Absolute path to the file", required: true },
      content: { type: "string", description: "Content to write", required: true },
    },
  },
  {
    name: "edit_file",
    description: "Replace a string in a file. old_string must be unique in the file.",
    parameters: {
      file_path: { type: "string", description: "Absolute path to the file", required: true },
      old_string: { type: "string", description: "Text to find", required: true },
      new_string: { type: "string", description: "Replacement text", required: true },
    },
  },
  {
    name: "bash",
    description: "Execute a shell command and return output",
    parameters: {
      command: { type: "string", description: "The command to execute", required: true },
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern",
    parameters: {
      pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)", required: true },
      path: { type: "string", description: "Directory to search in" },
    },
  },
  {
    name: "grep",
    description: "Search file contents with a regex pattern",
    parameters: {
      pattern: { type: "string", description: "Regex pattern to search for", required: true },
      path: { type: "string", description: "File or directory to search in" },
    },
  },
];

export async function executeTool(name: string, input: Record<string, string>): Promise<string> {
  switch (name) {
    case "read_file":
      return readFile(input.file_path, parseInt(input.offset) || undefined, parseInt(input.limit) || undefined);
    case "write_file":
      return writeFile(input.file_path, input.content);
    case "edit_file":
      return editFile(input.file_path, input.old_string, input.new_string);
    case "bash":
      return bash(input.command);
    case "glob":
      return globFiles(input.pattern, input.path);
    case "grep":
      return grepFiles(input.pattern, input.path);
    default:
      return `Error: Unknown tool "${name}"`;
  }
}

function readFile(filePath: string, offset?: number, limit?: number): string {
  const content = fs.readFileSync(filePath, "utf-8");
  let lines = content.split("\n");
  if (offset) lines = lines.slice(offset - 1);
  if (limit) lines = lines.slice(0, limit);
  return lines.map((line, i) => `${(offset ?? 1) + i}\t${line}`).join("\n");
}

function writeFile(filePath: string, content: string): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return `File written: ${filePath}`;
}

function editFile(filePath: string, oldString: string, newString: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const count = content.split(oldString).length - 1;
  if (count === 0) return `Error: old_string not found in ${filePath}`;
  if (count > 1) return `Error: old_string found ${count} times in ${filePath} — must be unique`;
  fs.writeFileSync(filePath, content.replace(oldString, newString));
  return `File edited: ${filePath}`;
}

async function bash(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    return (stdout + stderr).trim();
  } catch (err: any) {
    return `Error (exit ${err.code}): ${err.stderr || err.message}`;
  }
}

async function globFiles(pattern: string, dir?: string): Promise<string> {
  const cwd = dir || process.cwd();
  const matches: string[] = [];
  for await (const entry of glob(pattern, { cwd })) {
    matches.push(entry);
  }
  return matches.sort().join("\n") || "No files found.";
}

async function grepFiles(pattern: string, dir?: string): Promise<string> {
  const cwd = dir || process.cwd();
  try {
    const { stdout } = await execFileAsync("grep", ["-rn", pattern, cwd], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim() || "No matches found.";
  } catch {
    return "No matches found.";
  }
}
```

**Step 4: Run tests**

Run: `npm run build && npm test`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add src/tools.ts src/tools.test.ts
git commit -m "feat: add tool definitions and executor (read, write, edit, bash, glob, grep)"
```

---

### Task 7: System Prompt Builder

**Files:**
- Create: `src/prompt.ts`
- Create: `src/prompt.test.ts`

**Step 1: Write the failing test**

```typescript
// src/prompt.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSystemPrompt } from "./prompt.js";

describe("buildSystemPrompt", () => {
  it("includes tool definitions", () => {
    const prompt = buildSystemPrompt("/test/project");
    assert.ok(prompt.includes("<function=read_file>"));
    assert.ok(prompt.includes("<function=write_file>"));
    assert.ok(prompt.includes("<function=edit_file>"));
    assert.ok(prompt.includes("<function=bash>"));
    assert.ok(prompt.includes("<function=glob>"));
    assert.ok(prompt.includes("<function=grep>"));
  });

  it("includes working directory", () => {
    const prompt = buildSystemPrompt("/my/project");
    assert.ok(prompt.includes("/my/project"));
  });

  it("includes tool_call format instructions", () => {
    const prompt = buildSystemPrompt("/test");
    assert.ok(prompt.includes("<tool_call>"));
    assert.ok(prompt.includes("</tool_call>"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/prompt.ts
import { TOOL_DEFINITIONS } from "./tools.js";

export function buildSystemPrompt(workingDirectory: string): string {
  const toolSection = TOOL_DEFINITIONS.map((tool) => {
    const params = Object.entries(tool.parameters)
      .map(([name, p]) => `  - ${name} (${p.type}${p.required ? ", required" : ""}): ${p.description}`)
      .join("\n");
    return `### ${tool.name}\n${tool.description}\nParameters:\n${params}`;
  }).join("\n\n");

  return `You are Mallex Code, a local coding assistant. You help users with software engineering tasks by reading, writing, and editing code files, running shell commands, and searching codebases.

Working directory: ${workingDirectory}

## Tools

You have access to the following tools. To use a tool, you MUST output a tool_call block in this exact format:

<tool_call>
<function=tool_name>
<parameter=param_name>value</parameter>
</function>
</tool_call>

IMPORTANT:
- Always include the opening <tool_call> tag. Never omit it.
- You may include text before a tool call to explain what you're doing.
- You may make multiple tool calls in one response.
- After a tool call, wait for the result before continuing.

## Available Tools

${toolSection}

## Guidelines

- Read files before modifying them.
- Use absolute file paths.
- Prefer editing existing files over creating new ones.
- For bash commands, use the working directory as context.
- Be concise in your responses.`;
}
```

**Step 4: Run tests**

Run: `npm run build && npm test`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/prompt.ts src/prompt.test.ts
git commit -m "feat: add system prompt builder with tool definitions"
```

---

### Task 8: API Client (mlx-lm.server)

**Files:**
- Create: `src/client.ts`
- Create: `src/client.test.ts`

**Step 1: Write the failing test**

```typescript
// src/client.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildRequestBody, parseResponse, type ChatMessage } from "./client.js";

describe("buildRequestBody", () => {
  it("builds correct OpenAI chat completions request", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const body = buildRequestBody(messages, "test-model");
    assert.strictEqual(body.model, "test-model");
    assert.strictEqual(body.messages.length, 2);
    assert.strictEqual(body.messages[0].role, "system");
  });
});

describe("parseResponse", () => {
  it("extracts assistant content from OpenAI response", () => {
    const response = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello! Let me help.",
          },
          finish_reason: "stop",
        },
      ],
    };
    const result = parseResponse(response);
    assert.strictEqual(result.content, "Hello! Let me help.");
    assert.strictEqual(result.finishReason, "stop");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/client.ts

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  top_p: number;
}

export interface ChatResponseParsed {
  content: string;
  finishReason: string;
}

export function buildRequestBody(
  messages: ChatMessage[],
  model: string,
  maxTokens: number = 4096,
): ChatRequestBody {
  return {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 0.95,
  };
}

export function parseResponse(response: any): ChatResponseParsed {
  const choice = response.choices?.[0];
  if (!choice) throw new Error("No choices in response");
  return {
    content: choice.message?.content ?? "",
    finishReason: choice.finish_reason ?? "stop",
  };
}

export async function chatCompletion(
  messages: ChatMessage[],
  model: string,
  port: number,
): Promise<ChatResponseParsed> {
  const body = buildRequestBody(messages, model);
  const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mlx-lm server error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return parseResponse(json);
}
```

**Step 4: Run tests**

Run: `npm run build && npm test`
Expected: All 2 tests PASS

**Step 5: Commit**

```bash
git add src/client.ts src/client.test.ts
git commit -m "feat: add API client for mlx-lm.server chat completions"
```

---

### Task 9: REPL Loop

**Files:**
- Create: `src/repl.ts`
- Modify: `src/index.ts`

**Step 1: Write the REPL**

```typescript
// src/repl.ts
import readline from "node:readline";
import { chatCompletion, type ChatMessage } from "./client.js";
import { parseToolCalls } from "./parser.js";
import { executeTool } from "./tools.js";
import { buildSystemPrompt } from "./prompt.js";

export async function startRepl(model: string, port: number): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const systemPrompt = buildSystemPrompt(process.cwd());
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  console.log("Mallex Code v0.1.0 — type your request (Ctrl+C to exit)\n");

  const prompt = (): Promise<string> =>
    new Promise((resolve) => rl.question("> ", resolve));

  while (true) {
    const userInput = await prompt();
    if (!userInput.trim()) continue;

    messages.push({ role: "user", content: userInput });

    // Agentic loop: keep going while model makes tool calls
    let continueLoop = true;
    while (continueLoop) {
      const response = await chatCompletion(messages, model, port);
      const parsed = parseToolCalls(response.content);

      if (parsed.text) {
        console.log(`\n${parsed.text}\n`);
      }

      if (parsed.toolCalls.length === 0) {
        messages.push({ role: "assistant", content: response.content });
        continueLoop = false;
        break;
      }

      // Execute each tool call
      messages.push({ role: "assistant", content: response.content });

      for (const toolCall of parsed.toolCalls) {
        // Bash requires approval
        if (toolCall.name === "bash") {
          const approved = await new Promise<boolean>((resolve) => {
            rl.question(
              `Run command: ${toolCall.input.command} [y/N] `,
              (answer) => resolve(answer.toLowerCase() === "y"),
            );
          });
          if (!approved) {
            messages.push({
              role: "user",
              content: `Tool result for ${toolCall.name}: User denied execution.`,
            });
            continue;
          }
        }

        console.log(`  [${toolCall.name}] ${Object.values(toolCall.input)[0] ?? ""}`);
        const result = await executeTool(toolCall.name, toolCall.input);
        messages.push({
          role: "user",
          content: `Tool result for ${toolCall.name}:\n${result}`,
        });
      }
    }
  }
}
```

**Step 2: Wire up the entry point**

```typescript
// src/index.ts
#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { getDeviceInfo, recommendModel } from "./device.js";
import { ensureServer, stopServer } from "./server.js";
import { startRepl } from "./repl.js";
import { saveConfig } from "./config.js";
import readline from "node:readline";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle server subcommands
  if (args[0] === "server") {
    if (args[1] === "stop") {
      console.log(stopServer() ? "Server stopped." : "No server running.");
      return;
    }
  }

  const config = loadConfig();

  // First run: recommend a model
  if (!config.model) {
    const device = await getDeviceInfo();
    console.log(`Detected: ${device.chip} with ${device.totalMemoryGB}GB RAM\n`);

    const rec = recommendModel(device.totalMemoryGB);
    console.log(`Recommended model: ${rec.description}`);
    console.log(`  ID: ${rec.modelId}\n`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) =>
      rl.question("Accept recommendation? (Y/n/custom model ID) ", resolve),
    );
    rl.close();

    if (answer.toLowerCase() === "n") {
      console.log("Setup cancelled.");
      return;
    }
    config.model = answer && answer.toLowerCase() !== "y" && answer !== "" ? answer : rec.modelId;
    saveConfig(config);
    console.log(`\nModel set to: ${config.model}\n`);
  }

  // Ensure server is running
  await ensureServer(config.model, config.serverPort);

  // Start REPL
  await startRepl(config.model, config.serverPort);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
```

**Step 3: Build and verify it compiles**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/repl.ts src/index.ts
git commit -m "feat: add REPL loop and CLI entry point with setup flow"
```

---

### Task 10: End-to-End Manual Test

**No new files — this is a verification task.**

**Step 1: Ensure Python dependencies are installed**

Run: `pip install mlx-lm`
Expected: mlx-lm installed

**Step 2: Build the project**

Run: `npm run build`

**Step 3: Run mallex**

Run: `node dist/index.js`
Expected:
- First run: detects device, recommends model, prompts for acceptance
- Downloads model (if not cached)
- Starts mlx-lm.server
- Opens interactive prompt

**Step 4: Test basic interaction**

Type: "Read the README.md file in this directory"
Expected: Model outputs a `<tool_call>` for read_file, file contents are displayed, model summarizes them.

**Step 5: Test file creation**

Type: "Create a file called /tmp/mallex-test.txt with the content 'hello from mallex'"
Expected: Model uses write_file tool, file is created.

**Step 6: Test bash (with approval)**

Type: "List the files in the current directory"
Expected: Model uses bash tool, prompts for approval, shows output.

**Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: Mallex Code v0.1.0 — local MLX coding assistant"
```
