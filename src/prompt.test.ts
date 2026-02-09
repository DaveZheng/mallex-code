import { describe, it } from "node:test";
import assert from "node:assert";
import { buildToolInjection, injectToolDefinitions } from "./prompt.js";

describe("buildToolInjection", () => {
  it("includes all tool definitions in XML format", () => {
    const injection = buildToolInjection();
    assert.ok(injection.includes('<tool name="read_file">'), "should include read_file tool");
    assert.ok(injection.includes('<tool name="write_file">'), "should include write_file tool");
    assert.ok(injection.includes('<tool name="edit_file">'), "should include edit_file tool");
    assert.ok(injection.includes('<tool name="bash">'), "should include bash tool");
    assert.ok(injection.includes('<tool name="glob">'), "should include glob tool");
    assert.ok(injection.includes('<tool name="grep">'), "should include grep tool");
    assert.ok(injection.includes('<tool name="web_search">'), "should include web_search tool");
    assert.ok(injection.includes('<tool name="web_fetch">'), "should include web_fetch tool");
    assert.ok(injection.includes('<tool name="ask_user">'), "should include ask_user tool");
  });

  it("includes tool_call format instructions", () => {
    const injection = buildToolInjection();
    assert.ok(injection.includes("<tool_call>"));
    assert.ok(injection.includes("</tool_call>"));
    assert.ok(injection.includes("<function=tool_name>"));
  });

  it("wraps tools in <tools> tags", () => {
    const injection = buildToolInjection();
    assert.ok(injection.includes("<tools>"));
    assert.ok(injection.includes("</tools>"));
  });

  it("includes EFFICIENT TOOL USE guidance", () => {
    const injection = buildToolInjection();
    assert.ok(injection.includes("EFFICIENT TOOL USE:"), "should include efficiency section");
    assert.ok(injection.includes('output_mode="count"'), "should mention count output mode");
    assert.ok(injection.includes("head_limit"), "should mention head_limit");
    assert.ok(injection.includes("30000 chars"), "should mention truncation limit");
  });

  it("includes enum attribute for grep output_mode", () => {
    const injection = buildToolInjection();
    assert.ok(injection.includes('enum="content,files_with_matches,count"'), "should include enum values");
  });
});

describe("injectToolDefinitions", () => {
  it("appends tool injection to existing system prompt", () => {
    const original = "You are a coding assistant.";
    const result = injectToolDefinitions(original);
    assert.ok(result.startsWith(original), "should preserve original prompt");
    assert.ok(result.includes('<tool name="read_file">'), "should include tool definitions");
  });

  it("preserves the original system prompt unchanged", () => {
    const original = "System prompt with special chars: <>&\"'";
    const result = injectToolDefinitions(original);
    assert.ok(result.startsWith(original));
  });
});
