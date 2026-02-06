import { describe, it } from "node:test";
import assert from "node:assert";
import { buildServerArgs, parseServerPid } from "./server.js";

describe("buildServerArgs", () => {
  it("builds correct mlx_lm.server command args", () => {
    const args = buildServerArgs("mlx-community/test-model", 8080);
    assert.deepStrictEqual(args, [
      "-m", "mlx_lm.server",
      "--model", "mlx-community/test-model",
      "--port", "8080",
    ]);
  });
});

describe("parseServerPid", () => {
  it("parses a valid PID file", () => {
    assert.strictEqual(parseServerPid("12345\n"), 12345);
  });

  it("returns null for empty content", () => {
    assert.strictEqual(parseServerPid(""), null);
  });

  it("returns null for non-numeric content", () => {
    assert.strictEqual(parseServerPid("not-a-pid"), null);
  });
});
