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

  it("handles missing both tool_call tags (bare function call)", () => {
    const output = `<function=read_file>
<parameter=file_path>/src/main.ts</parameter>
</function>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
    assert.strictEqual(result.toolCalls[0].input.file_path, "/src/main.ts");
  });

  it("strips <|im_end|> tokens from output", () => {
    const output = `The answer is 42.<|im_end|>`;
    const result = parseToolCalls(output);
    assert.strictEqual(result.text, "The answer is 42.");
    assert.strictEqual(result.toolCalls.length, 0);
  });

  it("strips <|im_end|> from tool call output", () => {
    const output = `<function=read_file>
<parameter=file_path>/src/main.ts</parameter>
</function><|im_end|>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "read_file");
  });
});
