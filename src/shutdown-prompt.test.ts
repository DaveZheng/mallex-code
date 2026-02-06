import { describe, it } from "node:test";
import assert from "node:assert";
import { handleServerShutdownWithDeps, type ShutdownDeps } from "./shutdown-prompt.js";
import { DEFAULT_CONFIG, type MallexConfig } from "./config.js";

function makeConfig(overrides?: Partial<MallexConfig>): MallexConfig {
  return { ...DEFAULT_CONFIG, model: "test-model", ...overrides };
}

function makeDeps(overrides?: Partial<ShutdownDeps>): ShutdownDeps & { stopped: boolean; saved: MallexConfig | null } {
  const state = { stopped: false, saved: null as MallexConfig | null };
  return {
    isServerHealthy: async () => true,
    stopServer: () => { state.stopped = true; return true; },
    saveConfig: (c) => { state.saved = { ...c }; },
    promptUser: async () => "1",
    ...overrides,
    ...state,
    // Re-bind state tracking through overrides
    get stopped() { return state.stopped; },
    get saved() { return state.saved; },
  };
}

describe("handleServerShutdownWithDeps", () => {
  it("skips when server is not healthy", async () => {
    const deps = makeDeps({ isServerHealthy: async () => false });
    const result = await handleServerShutdownWithDeps(makeConfig(), deps);
    assert.strictEqual(result.action, "skipped");
    assert.strictEqual(deps.stopped, false);
  });

  it("stops immediately when onExitServer is 'stop'", async () => {
    const deps = makeDeps();
    const result = await handleServerShutdownWithDeps(
      makeConfig({ onExitServer: "stop" }),
      deps,
    );
    assert.strictEqual(result.action, "stopped");
    assert.strictEqual(result.configChanged, false);
    assert.strictEqual(deps.stopped, true);
  });

  it("keeps immediately when onExitServer is 'keep'", async () => {
    const deps = makeDeps();
    const result = await handleServerShutdownWithDeps(
      makeConfig({ onExitServer: "keep" }),
      deps,
    );
    assert.strictEqual(result.action, "kept");
    assert.strictEqual(result.configChanged, false);
    assert.strictEqual(deps.stopped, false);
  });

  it("option 1: stops server, no config change", async () => {
    const deps = makeDeps({ promptUser: async () => "1" });
    const result = await handleServerShutdownWithDeps(makeConfig(), deps);
    assert.strictEqual(result.action, "stopped");
    assert.strictEqual(result.configChanged, false);
    assert.strictEqual(deps.stopped, true);
    assert.strictEqual(deps.saved, null);
  });

  it("option 2: keeps server, no config change", async () => {
    const deps = makeDeps({ promptUser: async () => "2" });
    const result = await handleServerShutdownWithDeps(makeConfig(), deps);
    assert.strictEqual(result.action, "kept");
    assert.strictEqual(result.configChanged, false);
    assert.strictEqual(deps.stopped, false);
    assert.strictEqual(deps.saved, null);
  });

  it("option 3: stops server and persists preference", async () => {
    const deps = makeDeps({ promptUser: async () => "3" });
    const config = makeConfig();
    const result = await handleServerShutdownWithDeps(config, deps);
    assert.strictEqual(result.action, "stopped");
    assert.strictEqual(result.configChanged, true);
    assert.strictEqual(deps.stopped, true);
    assert.strictEqual(config.onExitServer, "stop");
    assert.notStrictEqual(deps.saved, null);
    assert.strictEqual(deps.saved!.onExitServer, "stop");
  });

  it("option 4: keeps server and persists preference", async () => {
    const deps = makeDeps({ promptUser: async () => "4" });
    const config = makeConfig();
    const result = await handleServerShutdownWithDeps(config, deps);
    assert.strictEqual(result.action, "kept");
    assert.strictEqual(result.configChanged, true);
    assert.strictEqual(deps.stopped, false);
    assert.strictEqual(config.onExitServer, "keep");
    assert.notStrictEqual(deps.saved, null);
    assert.strictEqual(deps.saved!.onExitServer, "keep");
  });

  it("empty input defaults to stop", async () => {
    const deps = makeDeps({ promptUser: async () => "" });
    const result = await handleServerShutdownWithDeps(makeConfig(), deps);
    assert.strictEqual(result.action, "stopped");
    assert.strictEqual(deps.stopped, true);
  });

  it("invalid input defaults to stop", async () => {
    const deps = makeDeps({ promptUser: async () => "xyz" });
    const result = await handleServerShutdownWithDeps(makeConfig(), deps);
    assert.strictEqual(result.action, "stopped");
    assert.strictEqual(deps.stopped, true);
  });
});
