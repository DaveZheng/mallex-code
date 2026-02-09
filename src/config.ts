import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type IntentCategory = "chit_chat" | "simple_code" | "hard_question" | "try_again";
export type ModelTierNumber = 1 | 2 | 3;

export interface RoutingRule {
  tier: ModelTierNumber;
}

export interface TierModel {
  target: "local" | "claude";
  claudeModel?: string;
}

export interface RoutingConfig {
  rules: Record<IntentCategory, RoutingRule>;
  tiers: Record<ModelTierNumber, TierModel>;
  claudeApiKey?: string;
  authMethod?: "apikey" | "oauth";
}

export const DEFAULT_ROUTING_RULES: Record<IntentCategory, RoutingRule> = {
  chit_chat: { tier: 1 },
  simple_code: { tier: 1 },
  hard_question: { tier: 3 },
  try_again: { tier: 1 },
};

/**
 * Returns default tier→model mapping based on local model capability.
 * Qwen3-Coder-Next benchmarks near Sonnet, so medium defaults to local for those users.
 */
export function defaultTierModels(localModel: string): Record<ModelTierNumber, TierModel> {
  const isPowerful = localModel.toLowerCase().includes("qwen3-coder-next");
  return {
    1: { target: "local" },
    2: isPowerful
      ? { target: "local" }
      : { target: "claude", claudeModel: "claude-sonnet-4-5-20250929" },
    3: { target: "claude", claudeModel: "claude-opus-4-6" },
  };
}

export interface MallexConfig {
  model: string;
  serverPort: number;
  proxyPort: number;
  idleTimeoutMinutes: number;
  onExitServer: "ask" | "stop" | "keep";
  routing?: RoutingConfig;
}

export const DEFAULT_CONFIG: MallexConfig = {
  model: "",
  serverPort: 8080,
  proxyPort: 3456,
  idleTimeoutMinutes: 15,
  onExitServer: "ask",
};

function configDir(baseDir?: string): string {
  return baseDir ?? path.join(os.homedir(), ".mallex");
}

export function loadConfig(baseDir?: string): MallexConfig {
  const dir = configDir(baseDir);
  const filePath = path.join(dir, "config.json");
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return { ...DEFAULT_CONFIG, ...raw };
}

export function saveConfig(config: MallexConfig, baseDir?: string): void {
  const dir = configDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
}
