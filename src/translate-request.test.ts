import { describe, it } from "node:test";
import assert from "node:assert";
import { translateRequest, type AnthropicRequest } from "./translate-request.js";

describe("translateRequest", () => {
  const mlxModel = "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit";

  it("translates a simple user message", () => {
    const req: AnthropicRequest = {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8192,
      system: "You are a coding assistant.",
      messages: [
        { role: "user", content: "Hello" },
      ],
    };
    const result = translateRequest(req, mlxModel);
    assert.strictEqual(result.model, mlxModel);
    assert.strictEqual(result.max_tokens, 8192);
    assert.strictEqual(result.messages[0].role, "system");
    assert.ok(result.messages[0].content.includes("You are a coding assistant."));
    assert.ok(result.messages[0].content.includes("<tools>"), "should inject tool definitions");
    assert.strictEqual(result.messages[1].role, "user");
    assert.strictEqual(result.messages[1].content, "Hello");
  });

  it("converts tool_use blocks in assistant messages to XML", () => {
    const req: AnthropicRequest = {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      messages: [
        { role: "user", content: "Read src/index.ts" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me read that." },
            { type: "tool_use", id: "call_1", name: "Read", input: { file_path: "src/index.ts" } },
          ],
        },
      ],
    };
    const result = translateRequest(req, mlxModel);
    const assistantMsg = result.messages[2].content;
    assert.ok(assistantMsg.includes("Let me read that."));
    assert.ok(assistantMsg.includes("<tool_call>"));
    assert.ok(assistantMsg.includes("<function=Read>"));
    assert.ok(assistantMsg.includes("<parameter=file_path>src/index.ts</parameter>"));
  });

  it("converts tool_result blocks to plain text", () => {
    const req: AnthropicRequest = {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "file contents here" },
          ],
        },
      ],
    };
    const result = translateRequest(req, mlxModel);
    const userMsg = result.messages[1].content;
    assert.ok(userMsg.includes("Tool result for call_1:"));
    assert.ok(userMsg.includes("file contents here"));
  });

  it("handles system prompt as array of text blocks", () => {
    const req: AnthropicRequest = {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: [
        { type: "text", text: "Part one." },
        { type: "text", text: "Part two." },
      ],
      messages: [
        { role: "user", content: "Hi" },
      ],
    };
    const result = translateRequest(req, mlxModel);
    assert.ok(result.messages[0].content.includes("Part one."));
    assert.ok(result.messages[0].content.includes("Part two."));
  });

  it("ignores Anthropic model and uses configured MLX model", () => {
    const req: AnthropicRequest = {
      model: "claude-opus-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: "Hi" }],
    };
    const result = translateRequest(req, mlxModel);
    assert.strictEqual(result.model, mlxModel);
  });

  it("sets stream flag from request", () => {
    const req: AnthropicRequest = {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      stream: true,
      messages: [{ role: "user", content: "Hi" }],
    };
    const result = translateRequest(req, mlxModel);
    assert.strictEqual(result.stream, true);
  });
});
