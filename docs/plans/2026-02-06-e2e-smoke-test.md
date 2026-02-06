# E2E Smoke Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real integration smoke test that hits the live mlx-lm server, sends a real prompt, verifies the model produces a parseable tool call, executes the tool, and confirms the full agentic loop completes. Gated behind `MLX_E2E=1` so normal `npm test` skips it.

**Architecture:** The test loads the user's real `~/.mallex/config.json` to get model + port, checks the server is healthy (skips if not), creates a temp fixture file, sends a prompt designed to elicit a `read_file` tool call, and walks the agentic loop exactly as `repl.ts` does. Assertions are loose since model output is non-deterministic — we check structure (did the parser find a tool call? did the tool execute? did we get a final response?) not exact content.

**Tech Stack:** Node.js built-in `node:test`, `node:assert` — no new dependencies.

---

### Task 1: Create the e2e smoke test file

**Files:**
- Create: `src/e2e.test.ts`

The test reads real config, checks server health, and runs the full agentic loop against the live model. Uses `node:test`'s `skip()` to bail out gracefully when the server isn't available or `MLX_E2E` isn't set.

**Step 1: Write the test**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./config.js";
import { isServerHealthy } from "./server.js";
import { chatCompletion, type ChatMessage } from "./client.js";
import { parseToolCalls } from "./parser.js";
import { executeTool } from "./tools.js";
import { buildSystemPrompt } from "./prompt.js";

describe("e2e smoke test", { skip: !process.env.MLX_E2E }, () => {
  let tmpDir: string;
  let model: string;
  let port: number;

  before(async () => {
    const config = loadConfig();
    model = config.model;
    port = config.serverPort;

    if (!model) {
      throw new Error("No model configured in ~/.mallex/config.json — run mallex first");
    }

    const healthy = await isServerHealthy(port);
    if (!healthy) {
      throw new Error(`mlx-lm server not running on port ${port} — start it with: mallex`);
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mallex-e2e-"));
    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "hello from e2e smoke test\n");
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true });
  });

  it("model produces a tool call that the parser extracts and tool executor runs", async () => {
    const filePath = path.join(tmpDir, "hello.txt");
    const systemPrompt = buildSystemPrompt(tmpDir);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Read the file ${filePath}` },
    ];

    // Turn 1: model should produce a read_file tool call
    const response1 = await chatCompletion(messages, model, port);
    assert.ok(response1.content.length > 0, "Model returned empty response");

    const parsed1 = parseToolCalls(response1.content);
    assert.ok(parsed1.toolCalls.length > 0, "Model did not produce any tool calls");

    const toolCall = parsed1.toolCalls[0];
    assert.strictEqual(toolCall.name, "read_file", `Expected read_file, got ${toolCall.name}`);
    assert.ok(toolCall.input.file_path, "Tool call missing file_path parameter");

    // Execute the tool
    messages.push({ role: "assistant", content: response1.content });
    const toolResult = await executeTool(toolCall.name, toolCall.input);
    assert.ok(toolResult.includes("hello from e2e smoke test"), "Tool did not read the fixture file correctly");

    messages.push({
      role: "user",
      content: `Tool result for ${toolCall.name}:\n${toolResult}`,
    });

    // Turn 2: model should return a final text response (no more tool calls)
    const response2 = await chatCompletion(messages, model, port);
    assert.ok(response2.content.length > 0, "Model returned empty final response");

    const parsed2 = parseToolCalls(response2.content);
    // Model might make another tool call — that's fine for a smoke test.
    // The key assertion is that we got a response and the loop can continue.
    assert.ok(parsed2.text.length > 0 || parsed2.toolCalls.length > 0,
      "Final response had neither text nor tool calls");
  });
});
```

**Step 2: Build and verify it compiles**

Run: `npm run build`
Expected: Compiles with no errors

**Step 3: Run without MLX_E2E — should skip**

Run: `node --test dist/e2e.test.js`
Expected: Test shows as skipped

**Step 4: Run with MLX_E2E (requires server running)**

Run: `MLX_E2E=1 node --test dist/e2e.test.js`
Expected: Test passes (server must be running with a model loaded)

---

### Task 2: Add npm scripts

**Files:**
- Modify: `package.json`

Add `test:e2e` script. The existing `test` script keeps running all `*.test.js` files — e2e tests self-skip via the `MLX_E2E` guard, so they won't slow down or break normal test runs.

**Step 1: Add the script**

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "test": "node --test dist/**/*.test.js",
    "test:e2e": "MLX_E2E=1 node --test dist/e2e.test.js"
  }
}
```

**Step 2: Verify**

Run: `npm test` — all tests pass, e2e skipped
Run: `npm run test:e2e` — e2e runs against live server

**Step 3: Commit**

```bash
git add src/e2e.test.ts package.json
git commit -m "test: add e2e smoke test against live mlx-lm server"
```

---

## Future Expansion

This is the foundation for a real integration test suite. Future additions (not in scope now):

- **Multi-tool chain:** Prompt that triggers read → edit → read to test multi-step agentic loops
- **write_file test:** Prompt that asks model to create a file, verify it exists on disk
- **bash tool test:** Prompt that triggers a shell command, verify output
- **Parser resilience:** Verify real model output (with whatever quirks) is handled by the parser
- **Timeout / error handling:** Test behavior when model takes too long or returns garbage
- **CI on Apple Silicon runner:** Nightly job on a Mac runner with mlx-lm pre-installed
- **Triggered runs:** Run on large features or migrations via `MLX_E2E=1 npm run test:e2e`
