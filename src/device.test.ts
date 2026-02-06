import { describe, it } from "node:test";
import assert from "node:assert";
import { getDeviceInfo, recommendModel } from "./device.js";

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
