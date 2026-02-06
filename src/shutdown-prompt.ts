import readline from "node:readline";
import { stopServer, isServerHealthy } from "./server.js";
import { saveConfig, type MallexConfig } from "./config.js";

export interface ShutdownDeps {
  isServerHealthy: (port: number) => Promise<boolean>;
  stopServer: () => boolean;
  saveConfig: (config: MallexConfig) => void;
  promptUser: () => Promise<string>;
}

export interface ShutdownResult {
  action: "stopped" | "kept" | "skipped";
  configChanged: boolean;
}

export async function handleServerShutdownWithDeps(
  config: MallexConfig,
  deps: ShutdownDeps,
): Promise<ShutdownResult> {
  const healthy = await deps.isServerHealthy(config.serverPort);
  if (!healthy) return { action: "skipped", configChanged: false };

  if (config.onExitServer === "stop") {
    deps.stopServer();
    return { action: "stopped", configChanged: false };
  }

  if (config.onExitServer === "keep") {
    return { action: "kept", configChanged: false };
  }

  const answer = await deps.promptUser();
  const choice = answer.trim() || "1";

  switch (choice) {
    case "1":
      deps.stopServer();
      return { action: "stopped", configChanged: false };
    case "2":
      return { action: "kept", configChanged: false };
    case "3":
      deps.stopServer();
      config.onExitServer = "stop";
      deps.saveConfig(config);
      return { action: "stopped", configChanged: true };
    case "4":
      config.onExitServer = "keep";
      deps.saveConfig(config);
      return { action: "kept", configChanged: true };
    default:
      deps.stopServer();
      return { action: "stopped", configChanged: false };
  }
}

function showPrompt(): Promise<string> {
  console.log("\nMLX server is still running.\n");
  console.log("  1) Shut down server");
  console.log("  2) Keep server alive");
  console.log("  3) Always shut down on exit (saves preference)");
  console.log("  4) Always keep alive on exit (saves preference)\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string>((resolve) => {
    rl.on("close", () => resolve("1"));
    rl.question("Choose [1-4] (default: 1): ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function handleServerShutdown(config: MallexConfig): Promise<void> {
  const result = await handleServerShutdownWithDeps(config, {
    isServerHealthy,
    stopServer,
    saveConfig,
    promptUser: showPrompt,
  });

  switch (result.action) {
    case "stopped":
      if (result.configChanged) {
        console.log("MLX server stopped. Preference saved — will always stop on exit.");
      } else if (config.onExitServer === "stop") {
        console.log("MLX server stopped (per saved preference).");
      } else {
        console.log("MLX server stopped.");
      }
      break;
    case "kept":
      if (result.configChanged) {
        console.log("MLX server left running. Preference saved — will always keep alive on exit.");
      } else if (config.onExitServer === "keep") {
        console.log("MLX server left running (per saved preference).");
      } else {
        console.log("MLX server left running. Stop later with: mallex server stop");
      }
      break;
  }
}
