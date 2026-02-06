import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";

describe("TOOL_DEFINITIONS", () => {
  it("includes all 6 core tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    assert.deepStrictEqual(names.sort(), [
      "bash", "edit_file", "glob", "grep", "read_file", "write_file",
    ].sort());
  });
});

describe("executeTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mallex-tools-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("read_file reads a file with line numbers", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "hello\nworld\n");
    const result = await executeTool("read_file", { file_path: filePath });
    assert.ok(result.includes("1\thello"));
    assert.ok(result.includes("2\tworld"));
  });

  it("write_file creates a file", async () => {
    const filePath = path.join(tmpDir, "new.txt");
    await executeTool("write_file", { file_path: filePath, content: "test content" });
    assert.strictEqual(fs.readFileSync(filePath, "utf-8"), "test content");
  });

  it("edit_file replaces string in file", async () => {
    const filePath = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(filePath, "foo bar baz");
    await executeTool("edit_file", {
      file_path: filePath,
      old_string: "bar",
      new_string: "qux",
    });
    assert.strictEqual(fs.readFileSync(filePath, "utf-8"), "foo qux baz");
  });

  it("glob finds files by pattern", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "c.js"), "");
    const result = await executeTool("glob", { pattern: "*.ts", path: tmpDir });
    assert.ok(result.includes("a.ts"));
    assert.ok(result.includes("b.ts"));
    assert.ok(!result.includes("c.js"));
  });

  it("grep searches file contents", async () => {
    fs.writeFileSync(path.join(tmpDir, "search.txt"), "line one\nfind me\nline three\n");
    const result = await executeTool("grep", { pattern: "find", path: tmpDir });
    assert.ok(result.includes("find me"));
  });

  it("bash executes a command", async () => {
    const result = await executeTool("bash", { command: "echo hello" });
    assert.ok(result.includes("hello"));
  });
});
