#!/usr/bin/env node
import { loadConfig, saveConfig } from "./config.js";
import { getDeviceInfo, recommendModel } from "./device.js";
import { ensureServer, stopServer } from "./server.js";
import { startRepl } from "./repl.js";
import readline from "node:readline";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle server subcommands
  if (args[0] === "server") {
    if (args[1] === "stop") {
      console.log(stopServer() ? "Server stopped." : "No server running.");
      return;
    }
  }

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

  // Ensure server is running
  await ensureServer(config.model, config.serverPort);

  // Start REPL
  await startRepl(config.model, config.serverPort);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
