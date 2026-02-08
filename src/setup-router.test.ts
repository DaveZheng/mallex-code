import { describe, it } from "node:test";
import assert from "node:assert";
import { runRouterSetupWithDeps, type RouterSetupDeps } from "./setup-router.js";
import { DEFAULT_ROUTING_RULES } from "./config.js";

function makeDeps(answers: string[]): RouterSetupDeps & { logs: string[] } {
  let index = 0;
  const logs: string[] = [];
  return {
    promptUser: async (_question: string) => {
      const answer = answers[index] ?? "";
      index++;
      return answer;
    },
    log: (message: string) => {
      logs.push(message);
    },
    logs,
  };
}

describe("runRouterSetupWithDeps", () => {
  it("accept defaults with small model — tier 2 is claude/sonnet, tier 3 is claude/opus", async () => {
    const deps = makeDeps(["Y", "sk-ant-test"]);
    const result = await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "claude");
    assert.strictEqual(result.routing.tiers[2].claudeModel, "claude-sonnet-4-5-20250929");
    assert.strictEqual(result.routing.tiers[3].target, "claude");
    assert.strictEqual(result.routing.tiers[3].claudeModel, "claude-opus-4-6");
    assert.deepStrictEqual(result.routing.rules, DEFAULT_ROUTING_RULES);
    assert.strictEqual(result.routing.claudeApiKey, "sk-ant-test");
  });

  it("accept defaults with powerful model — tier 2 defaults to local", async () => {
    const deps = makeDeps(["Y", "sk-ant-test"]);
    const result = await runRouterSetupWithDeps("Qwen3-Coder-Next-8bit", deps);

    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "local");
    assert.strictEqual(result.routing.tiers[3].target, "claude");
    assert.strictEqual(result.routing.tiers[3].claudeModel, "claude-opus-4-6");
    assert.strictEqual(result.routing.claudeApiKey, "sk-ant-test");
  });

  it("accept defaults with no API key — all claude tiers downgraded to local", async () => {
    const deps = makeDeps(["Y", ""]);
    const result = await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "local");
    assert.strictEqual(result.routing.tiers[3].target, "local");
    assert.strictEqual(result.routing.claudeApiKey, undefined);

    assert.ok(
      deps.logs.some((l) => l.includes("No API key provided")),
      "Expected downgrade warning in logs",
    );
  });

  it("custom tiers — respects per-tier input", async () => {
    const deps = makeDeps(["n", "local", "claude-sonnet-4-5-20250929", "claude-opus-4-6", "sk-ant-custom"]);
    const result = await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "claude");
    assert.strictEqual(result.routing.tiers[2].claudeModel, "claude-sonnet-4-5-20250929");
    assert.strictEqual(result.routing.tiers[3].target, "claude");
    assert.strictEqual(result.routing.tiers[3].claudeModel, "claude-opus-4-6");
    assert.strictEqual(result.routing.claudeApiKey, "sk-ant-custom");
  });

  it("custom with 'local' for all tiers — no API key prompt needed", async () => {
    const deps = makeDeps(["n", "local", "local", "local"]);
    const result = await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "local");
    assert.strictEqual(result.routing.tiers[3].target, "local");
    assert.strictEqual(result.routing.claudeApiKey, undefined);
  });

  it("empty input uses defaults", async () => {
    // Empty accept answer treated as "Y", then empty API key triggers downgrade
    const deps = makeDeps(["", ""]);
    const result = await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    // Defaults for small model: tier 2=claude, tier 3=claude, but no API key → all downgraded
    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "local");
    assert.strictEqual(result.routing.tiers[3].target, "local");
    assert.strictEqual(result.routing.claudeApiKey, undefined);
  });

  it("powerful model medium defaults to local — only needs API key for tier 3", async () => {
    const deps = makeDeps(["Y", "sk-ant-powerful"]);
    const result = await runRouterSetupWithDeps("Qwen3-Coder-Next-8bit", deps);

    // Tier 2 is local by default for powerful models
    assert.strictEqual(result.routing.tiers[2].target, "local");
    // Tier 3 still needs claude
    assert.strictEqual(result.routing.tiers[3].target, "claude");
    assert.strictEqual(result.routing.tiers[3].claudeModel, "claude-opus-4-6");
    assert.strictEqual(result.routing.claudeApiKey, "sk-ant-powerful");

    // Rules should always be the defaults
    assert.deepStrictEqual(result.routing.rules, DEFAULT_ROUTING_RULES);
  });
});
