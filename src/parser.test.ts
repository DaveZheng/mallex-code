import { describe, it } from "node:test";
import assert from "node:assert";
import { parseToolCalls, type ParsedToolCall } from "./parser.js";

describe("parseToolCalls", () => {
  it("parses a single tool call and maps name to Claude Code format", () => {
    const output = `Let me read that file.

<tool_call>
<function=read_file>
<parameter=file_path>/src/main.ts</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.text, "Let me read that file.");
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "Read");
    assert.deepStrictEqual(result.toolCalls[0].input, { file_path: "/src/main.ts" });
  });

  it("parses multiple parameters and maps edit_file to Edit", () => {
    const output = `<tool_call>
<function=edit_file>
<parameter=file_path>/src/main.ts</parameter>
<parameter=old_string>const x = 1;</parameter>
<parameter=new_string>const x = 2;</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].name, "Edit");
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
    assert.strictEqual(result.toolCalls[0].name, "Write");
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
    assert.strictEqual(result.toolCalls[0].name, "Read");
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
    assert.strictEqual(result.toolCalls[0].name, "Read");
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
    assert.strictEqual(result.toolCalls[0].name, "Read");
  });

  it("maps bash tool name to Bash", () => {
    const output = `<tool_call>
<function=bash>
<parameter=command>ls -la</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].name, "Bash");
    assert.strictEqual(result.toolCalls[0].input.command, "ls -la");
  });

  it("maps grep tool name to Grep", () => {
    const output = `<tool_call>
<function=grep>
<parameter=pattern>TODO</parameter>
<parameter=path>/src</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].name, "Grep");
    assert.strictEqual(result.toolCalls[0].input.pattern, "TODO");
  });

  it("maps glob tool name to Glob", () => {
    const output = `<tool_call>
<function=glob>
<parameter=pattern>**/*.ts</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].name, "Glob");
  });

  it("handles stop sequence truncation (missing </tool_call>)", () => {
    // When stop=["</tool_call>"], the model output ends before the closing tag
    const output = `Let me check.

<tool_call>
<function=read_file>
<parameter=file_path>/src/main.ts</parameter>
</function>
`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "Read");
    assert.strictEqual(result.toolCalls[0].input.file_path, "/src/main.ts");
  });

  it("handles stop sequence truncation (missing </function> and </tool_call>)", () => {
    // Extreme truncation — stop sequence fired before </function>
    const output = `<tool_call>
<function=bash>
<parameter=command>echo hello</parameter>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "Bash");
    assert.strictEqual(result.toolCalls[0].input.command, "echo hello");
  });

  it("passes through unknown tool names unchanged", () => {
    const output = `<tool_call>
<function=custom_tool>
<parameter=arg>value</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].name, "custom_tool");
  });

  it("maps web_search to WebSearch", () => {
    const output = `<tool_call>
<function=web_search>
<parameter=query>TypeScript generics</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].name, "WebSearch");
    assert.strictEqual(result.toolCalls[0].input.query, "TypeScript generics");
  });

  it("maps web_fetch to WebFetch", () => {
    const output = `<tool_call>
<function=web_fetch>
<parameter=url>https://example.com</parameter>
<parameter=prompt>Extract the main content</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].name, "WebFetch");
    assert.strictEqual(result.toolCalls[0].input.url, "https://example.com");
    assert.strictEqual(result.toolCalls[0].input.prompt, "Extract the main content");
  });

  it("maps ask_user to AskUserQuestion", () => {
    const output = `<tool_call>
<function=ask_user>
<parameter=question>Which database should I use?</parameter>
</function>
</tool_call>`;

    const result = parseToolCalls(output);
    assert.strictEqual(result.toolCalls[0].name, "AskUserQuestion");
    assert.strictEqual(result.toolCalls[0].input.question, "Which database should I use?");
  });
});
