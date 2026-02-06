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

    // Turn 2: model should return a final text response
    const response2 = await chatCompletion(messages, model, port);
    assert.ok(response2.content.length > 0, "Model returned empty final response");

    const parsed2 = parseToolCalls(response2.content);
    assert.ok(parsed2.text.length > 0 || parsed2.toolCalls.length > 0,
      "Final response had neither text nor tool calls");
  });
});
