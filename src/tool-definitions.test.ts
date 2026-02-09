import { describe, it } from "node:test";
import assert from "node:assert";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

describe("TOOL_DEFINITIONS", () => {
  it("includes all 9 tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    assert.deepStrictEqual(names.sort(), [
      "ask_user", "bash", "edit_file", "glob", "grep",
      "read_file", "web_fetch", "web_search", "write_file",
    ].sort());
  });

  it("grep has output_mode with enum values", () => {
    const grep = TOOL_DEFINITIONS.find((t) => t.name === "grep")!;
    const outputMode = grep.parameters.output_mode;
    assert.ok(outputMode, "grep should have output_mode parameter");
    assert.deepStrictEqual(outputMode.enum, ["content", "files_with_matches", "count"]);
  });

  it("grep has head_limit parameter", () => {
    const grep = TOOL_DEFINITIONS.find((t) => t.name === "grep")!;
    assert.ok(grep.parameters.head_limit, "grep should have head_limit");
  });

  it("bash has description and timeout parameters", () => {
    const bash = TOOL_DEFINITIONS.find((t) => t.name === "bash")!;
    assert.ok(bash.parameters.description, "bash should have description parameter");
    assert.ok(bash.parameters.timeout, "bash should have timeout parameter");
    assert.ok(bash.description.includes("truncated"), "bash description should mention truncation");
  });

  it("read_file has pages parameter", () => {
    const readFile = TOOL_DEFINITIONS.find((t) => t.name === "read_file")!;
    assert.ok(readFile.parameters.pages, "read_file should have pages parameter");
  });

  it("edit_file has replace_all parameter", () => {
    const editFile = TOOL_DEFINITIONS.find((t) => t.name === "edit_file")!;
    assert.ok(editFile.parameters.replace_all, "edit_file should have replace_all parameter");
  });

  it("web_search has required query parameter", () => {
    const ws = TOOL_DEFINITIONS.find((t) => t.name === "web_search")!;
    assert.ok(ws.parameters.query.required, "query should be required");
  });

  it("web_fetch has required url and prompt parameters", () => {
    const wf = TOOL_DEFINITIONS.find((t) => t.name === "web_fetch")!;
    assert.ok(wf.parameters.url.required, "url should be required");
    assert.ok(wf.parameters.prompt.required, "prompt should be required");
  });

  it("ask_user has required question parameter", () => {
    const au = TOOL_DEFINITIONS.find((t) => t.name === "ask_user")!;
    assert.ok(au.parameters.question.required, "question should be required");
  });
});
