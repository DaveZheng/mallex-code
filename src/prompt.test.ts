import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSystemPrompt } from "./prompt.js";

describe("buildSystemPrompt", () => {
  it("includes tool definitions", () => {
    const prompt = buildSystemPrompt("/test/project");
    assert.ok(prompt.includes("### read_file"), "should include read_file tool");
    assert.ok(prompt.includes("### write_file"), "should include write_file tool");
    assert.ok(prompt.includes("### edit_file"), "should include edit_file tool");
    assert.ok(prompt.includes("### bash"), "should include bash tool");
    assert.ok(prompt.includes("### glob"), "should include glob tool");
    assert.ok(prompt.includes("### grep"), "should include grep tool");
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
