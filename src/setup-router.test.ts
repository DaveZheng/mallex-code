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
  it("accept defaults with small model — tier 2 is claude/sonnet, tier 3 is claude/opus, authMethod is oauth", async () => {
    const deps = makeDeps(["Y"]);
    const result = await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "claude");
    assert.strictEqual(result.routing.tiers[2].claudeModel, "claude-sonnet-4-5-20250929");
    assert.strictEqual(result.routing.tiers[3].target, "claude");
    assert.strictEqual(result.routing.tiers[3].claudeModel, "claude-opus-4-6");
    assert.deepStrictEqual(result.routing.rules, DEFAULT_ROUTING_RULES);
    assert.strictEqual(result.routing.authMethod, "oauth");
  });

  it("accept defaults with powerful model — tier 2 defaults to local", async () => {
    const deps = makeDeps(["Y"]);
    const result = await runRouterSetupWithDeps("Qwen3-Coder-Next-8bit", deps);

    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "local");
    assert.strictEqual(result.routing.tiers[3].target, "claude");
    assert.strictEqual(result.routing.tiers[3].claudeModel, "claude-opus-4-6");
    assert.strictEqual(result.routing.authMethod, "oauth");
  });

  it("accept defaults — shows oauth login message when tiers need claude", async () => {
    const deps = makeDeps(["Y"]);
    await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    assert.ok(
      deps.logs.some((l) => l.includes("Claude Code login")),
      "Expected OAuth messaging in logs",
    );
  });

  it("custom tiers — respects per-tier input", async () => {
    const deps = makeDeps(["n", "local", "claude-sonnet-4-5-20250929", "claude-opus-4-6"]);
    const result = await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "claude");
    assert.strictEqual(result.routing.tiers[2].claudeModel, "claude-sonnet-4-5-20250929");
    assert.strictEqual(result.routing.tiers[3].target, "claude");
    assert.strictEqual(result.routing.tiers[3].claudeModel, "claude-opus-4-6");
    assert.strictEqual(result.routing.authMethod, "oauth");
  });

  it("custom with 'local' for all tiers — no oauth needed, authMethod undefined", async () => {
    const deps = makeDeps(["n", "local", "local", "local"]);
    const result = await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "local");
    assert.strictEqual(result.routing.tiers[3].target, "local");
    assert.strictEqual(result.routing.authMethod, undefined);
  });

  it("empty input uses defaults — accepts default tiers, sets oauth", async () => {
    const deps = makeDeps([""]);
    const result = await runRouterSetupWithDeps("Qwen2.5-Coder-7B-4bit", deps);

    // Defaults for small model: tier 2=claude, tier 3=claude
    assert.strictEqual(result.routing.tiers[1].target, "local");
    assert.strictEqual(result.routing.tiers[2].target, "claude");
    assert.strictEqual(result.routing.tiers[3].target, "claude");
    assert.strictEqual(result.routing.authMethod, "oauth");
  });

  it("powerful model medium defaults to local — only tier 3 needs claude", async () => {
    const deps = makeDeps(["Y"]);
    const result = await runRouterSetupWithDeps("Qwen3-Coder-Next-8bit", deps);

    assert.strictEqual(result.routing.tiers[2].target, "local");
    assert.strictEqual(result.routing.tiers[3].target, "claude");
    assert.strictEqual(result.routing.tiers[3].claudeModel, "claude-opus-4-6");
    assert.strictEqual(result.routing.authMethod, "oauth");
    assert.deepStrictEqual(result.routing.rules, DEFAULT_ROUTING_RULES);
  });
});
