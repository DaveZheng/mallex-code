import { describe, it } from "node:test";
import assert from "node:assert";
import { translateResponse } from "./translate-response.js";

describe("translateResponse", () => {
  const model = "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit";

  it("translates plain text response", () => {
    const result = translateResponse("Hello, how can I help?", model);
    assert.strictEqual(result.type, "message");
    assert.strictEqual(result.role, "assistant");
    assert.strictEqual(result.model, model);
    assert.strictEqual(result.stop_reason, "end_turn");
    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.content[0].type, "text");
    assert.strictEqual(result.content[0].text, "Hello, how can I help?");
  });

  it("translates response with tool call", () => {
    const modelOutput = [
      "Let me read that file.",
      "",
      "<tool_call>",
      "<function=Read>",
      "<parameter=file_path>src/index.ts</parameter>",
      "</function>",
      "</tool_call>",
    ].join("\n");

    const result = translateResponse(modelOutput, model);
    assert.strictEqual(result.stop_reason, "tool_use");
    assert.strictEqual(result.content.length, 2);
    assert.strictEqual(result.content[0].type, "text");
    assert.strictEqual(result.content[0].text, "Let me read that file.");
    assert.strictEqual(result.content[1].type, "tool_use");
    assert.strictEqual(result.content[1].name, "Read");
    assert.ok(result.content[1].id?.startsWith("toolu_"));
    assert.deepStrictEqual(result.content[1].input, { file_path: "src/index.ts" });
  });

  it("translates response with multiple tool calls", () => {
    const modelOutput = [
      "<tool_call>",
      "<function=Read>",
      "<parameter=file_path>a.ts</parameter>",
      "</function>",
      "</tool_call>",
      "<tool_call>",
      "<function=Read>",
      "<parameter=file_path>b.ts</parameter>",
      "</function>",
      "</tool_call>",
    ].join("\n");

    const result = translateResponse(modelOutput, model);
    assert.strictEqual(result.stop_reason, "tool_use");
    const toolBlocks = result.content.filter((b) => b.type === "tool_use");
    assert.strictEqual(toolBlocks.length, 2);
  });

  it("generates unique message and tool IDs", () => {
    const result = translateResponse("Hello", model);
    assert.ok(result.id.startsWith("msg_local_"));

    const withTool = translateResponse("<tool_call>\n<function=Read>\n<parameter=file_path>x</parameter>\n</function>\n</tool_call>", model);
    const toolBlock = withTool.content.find((b) => b.type === "tool_use");
    assert.ok(toolBlock?.id?.startsWith("toolu_"));
  });

  it("returns empty text block for empty model output", () => {
    const result = translateResponse("", model);
    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.content[0].type, "text");
    assert.strictEqual(result.content[0].text, "");
  });

  it("reports zero token usage", () => {
    const result = translateResponse("Hello", model);
    assert.deepStrictEqual(result.usage, { input_tokens: 0, output_tokens: 0 });
  });
});
