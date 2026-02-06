import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, DEFAULT_CONFIG, type MallexConfig } from "./config.js";

describe("config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mallex-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(tmpDir);
    assert.deepStrictEqual(config, DEFAULT_CONFIG);
  });

  it("saves and loads config", () => {
    const custom: MallexConfig = {
      model: "mlx-community/test-model-4bit",
      serverPort: 9090,
      idleTimeoutMinutes: 60,
    };
    saveConfig(custom, tmpDir);
    const loaded = loadConfig(tmpDir);
    assert.deepStrictEqual(loaded, custom);
  });

  it("merges partial config with defaults", () => {
    const partial = { model: "custom-model" };
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "config.json"), JSON.stringify(partial));
    const loaded = loadConfig(tmpDir);
    assert.strictEqual(loaded.model, "custom-model");
    assert.strictEqual(loaded.serverPort, DEFAULT_CONFIG.serverPort);
  });
});
