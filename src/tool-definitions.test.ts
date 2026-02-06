import { describe, it } from "node:test";
import assert from "node:assert";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

describe("TOOL_DEFINITIONS", () => {
  it("includes all 6 core tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    assert.deepStrictEqual(names.sort(), [
      "bash", "edit_file", "glob", "grep", "read_file", "write_file",
    ].sort());
  });
});
