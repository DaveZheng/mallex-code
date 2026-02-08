#!/usr/bin/env node
import http from "node:http";
import { loadConfig, saveConfig } from "./config.js";
import { getDeviceInfo, recommendModel, getAvailableMemoryGB, lookupModelSize } from "./device.js";
import { ensureDependencies, ensureServer, stopServer } from "./server.js";
import { startProxy, setShuttingDown } from "./proxy.js";
import { execFileSync, spawn } from "node:child_process";
import readline from "node:readline";
import { handleServerShutdown } from "./shutdown-prompt.js";
import { runRouterSetup } from "./setup-router.js";

let proxyServer: http.Server | undefined;

function cleanupSync(): void {
  setShuttingDown();
  if (proxyServer) {
    proxyServer.close();
    proxyServer = undefined;
  }
}

process.on("SIGINT", () => { cleanupSync(); process.exit(130); });
process.on("SIGTERM", () => { cleanupSync(); process.exit(143); });

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle server subcommands
  if (args[0] === "server") {
    if (args[1] === "stop") {
      console.log(stopServer() ? "Server stopped." : "No server running.");
      return;
    }
  }

  // Handle --setup: re-run router setup on existing config
  if (args.includes("--setup")) {
    const config = loadConfig();
    if (!config.model) {
      console.error("Error: Run mallex first to set up a model before configuring routing.");
      process.exit(1);
    }
    const result = await runRouterSetup(config.model);
    config.routing = result.routing;
    saveConfig(config);
    console.log("\nRouting configuration saved.");
    return;
  }

  // Strip --setup from args passed to claude (in case it's combined with other flags)
  const filteredArgs = args.filter((a) => a !== "--setup");
  const proxyOnly = filteredArgs[0] === "proxy";

  const config = loadConfig();

  // First run: recommend a model
  if (!config.model) {
    const device = await getDeviceInfo();
    console.log(`Detected: ${device.chip} with ${device.totalMemoryGB}GB RAM\n`);

    const rec = recommendModel(device.totalMemoryGB);
    console.log(`Recommended model: ${rec.description}`);
    console.log(`  ID: ${rec.modelId}\n`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) =>
      rl.question("Accept recommendation? (Y/n/custom model ID) ", resolve),
    );
    rl.close();

    if (answer.toLowerCase() === "n") {
      console.log("Setup cancelled.");
      return;
    }
    config.model = answer && answer.toLowerCase() !== "y" && answer !== "" ? answer : rec.modelId;
    saveConfig(config);
    console.log(`\nModel set to: ${config.model}\n`);
  }

  // Routing setup (runs on first run or when upgrading from pre-routing config)
  if (!config.routing) {
    const routingResult = await runRouterSetup(config.model);
    config.routing = routingResult.routing;
    saveConfig(config);
  }

  // Ensure python + mlx-lm are available (creates venv on first run)
  await ensureDependencies();

  // Memory check before loading model
  const modelSizeGB = lookupModelSize(config.model);
  if (modelSizeGB !== undefined) {
    const availableGB = await getAvailableMemoryGB();
    if (availableGB < modelSizeGB) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) =>
        rl.question(
          `Warning: ${availableGB.toFixed(1)}GB free memory, model needs ~${modelSizeGB}GB. Continue anyway? (Y/n) `,
          resolve,
        ),
      );
      rl.close();
      if (answer.toLowerCase() === "n") {
        console.log("Aborted.");
        return;
      }
    }
  }

  // Ensure mlx-lm.server is running
  await ensureServer(config.model, config.serverPort);

  // Start the translation proxy
  proxyServer = await startProxy({
    proxyPort: config.proxyPort,
    serverPort: config.serverPort,
    model: config.model,
    routing: config.routing,
  });

  if (proxyOnly) {
    console.log(`\nTo use with Claude Code:`);
    console.log(`  ANTHROPIC_BASE_URL=http://localhost:${config.proxyPort} ANTHROPIC_AUTH_TOKEN=local claude`);

    // Override SIGINT in proxy-only mode to show shutdown prompt
    process.removeAllListeners("SIGINT");
    process.on("SIGINT", async () => {
      console.log();
      cleanupSync();
      await handleServerShutdown(config);
      process.exit(0);
    });

    return;
  }

  // Check that claude is in PATH
  try {
    execFileSync("which", ["claude"], { stdio: "ignore" });
  } catch {
    console.error("\nError: 'claude' not found in PATH.");
    console.error("Install Claude Code: https://docs.anthropic.com/en/docs/claude-code");
    cleanupSync();
    process.exit(1);
  }

  // Spawn claude with inherited stdio so it takes over the terminal
  const claude = spawn("claude", filteredArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://localhost:${config.proxyPort}`,
      ANTHROPIC_AUTH_TOKEN: "local",
    },
  });

  claude.on("exit", async (code) => {
    cleanupSync();
    await handleServerShutdown(config);
    process.exit(code ?? 0);
  });

  claude.on("error", (err) => {
    console.error("Failed to launch claude:", err.message);
    cleanupSync();
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  cleanupSync();
  process.exit(1);
});
