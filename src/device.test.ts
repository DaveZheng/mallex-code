import { describe, it } from "node:test";
import assert from "node:assert";
import { getDeviceInfo, recommendModel, getAvailableMemoryGB, lookupModelSize, MODEL_TIERS } from "./device.js";

describe("getDeviceInfo", () => {
  it("returns chip and totalMemoryGB on macOS", async () => {
    const info = await getDeviceInfo();
    assert.ok(info.chip, "chip should be a non-empty string");
    assert.ok(info.totalMemoryGB > 0, "totalMemoryGB should be positive");
  });
});

describe("recommendModel", () => {
  it("recommends 7B model for 8GB", () => {
    const rec = recommendModel(8);
    assert.ok(rec.modelId.includes("Qwen2.5-Coder-7B"), `got ${rec.modelId}`);
    assert.strictEqual(rec.quantization, "4bit");
  });

  it("recommends 14B model for 16GB", () => {
    const rec = recommendModel(16);
    assert.ok(rec.modelId.includes("Qwen2.5-Coder-14B"), `got ${rec.modelId}`);
    assert.strictEqual(rec.quantization, "4bit");
  });

  it("recommends 30B-A3B for 32GB", () => {
    const rec = recommendModel(32);
    assert.ok(rec.modelId.includes("30B-A3B"), `got ${rec.modelId}`);
    assert.strictEqual(rec.quantization, "4bit");
  });

  it("recommends Coder-Next 4bit for 64GB", () => {
    const rec = recommendModel(64);
    assert.ok(rec.modelId.includes("Coder-Next"), `got ${rec.modelId}`);
    assert.strictEqual(rec.quantization, "4bit");
  });

  it("recommends Coder-Next 8bit for 128GB+", () => {
    const rec = recommendModel(128);
    assert.ok(rec.modelId.includes("Coder-Next"), `got ${rec.modelId}`);
    assert.strictEqual(rec.quantization, "8bit");
  });
});

describe("getAvailableMemoryGB", () => {
  it("returns a positive number on macOS", async () => {
    const gb = await getAvailableMemoryGB();
    assert.ok(typeof gb === "number", "should return a number");
    assert.ok(gb > 0, `should be positive, got ${gb}`);
    assert.ok(gb < 512, `should be reasonable (< 512GB), got ${gb}`);
  });
});

describe("lookupModelSize", () => {
  it("returns size for a known model", () => {
    const size = lookupModelSize("mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
    assert.strictEqual(size, 4);
  });

  it("returns size for another known model", () => {
    const size = lookupModelSize("mlx-community/Qwen2.5-Coder-14B-Instruct-4bit");
    assert.strictEqual(size, 8);
  });

  it("returns undefined for unknown models", () => {
    assert.strictEqual(lookupModelSize("some/custom-model"), undefined);
  });

  it("returns undefined for empty string", () => {
    assert.strictEqual(lookupModelSize(""), undefined);
  });
});

describe("MODEL_TIERS", () => {
  it("is exported and non-empty", () => {
    assert.ok(Array.isArray(MODEL_TIERS));
    assert.ok(MODEL_TIERS.length > 0);
  });

  it("every tier has required fields", () => {
    for (const tier of MODEL_TIERS) {
      assert.ok(typeof tier.modelId === "string");
      assert.ok(typeof tier.estimatedSizeGB === "number");
      assert.ok(tier.estimatedSizeGB > 0);
    }
  });
});
