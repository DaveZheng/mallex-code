import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface MallexConfig {
  model: string;
  serverPort: number;
  proxyPort: number;
  idleTimeoutMinutes: number;
}

export const DEFAULT_CONFIG: MallexConfig = {
  model: "",
  serverPort: 8080,
  proxyPort: 3456,
  idleTimeoutMinutes: 30,
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
