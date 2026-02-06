import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DeviceInfo {
  chip: string;
  totalMemoryGB: number;
}

export interface ModelRecommendation {
  modelId: string;
  quantization: string;
  estimatedSizeGB: number;
  description: string;
}

interface ModelTier {
  minRAM: number;
  modelId: string;
  quantization: string;
  estimatedSizeGB: number;
  description: string;
}

// Actual sizes verified from HuggingFace (2026-02-06)
// Budget = total RAM × 0.75 (reserve 25% for OS + apps)
const MODEL_TIERS: ModelTier[] = [
  {
    minRAM: 128,
    modelId: "mlx-community/Qwen3-Coder-Next-8bit",
    quantization: "8bit",
    estimatedSizeGB: 79,
    description: "Qwen3-Coder-Next (8-bit) — full quality, 256k context",
  },
  {
    minRAM: 64,
    modelId: "mlx-community/Qwen3-Coder-Next-4bit",
    quantization: "4bit",
    estimatedSizeGB: 42,
    description: "Qwen3-Coder-Next (4-bit) — best coding model, 256k context",
  },
  {
    minRAM: 32,
    modelId: "mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit",
    quantization: "4bit",
    estimatedSizeGB: 16,
    description: "Qwen3-Coder-30B-A3B (4-bit) — MoE, strong coding",
  },
  {
    minRAM: 16,
    modelId: "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit",
    quantization: "4bit",
    estimatedSizeGB: 8,
    description: "Qwen2.5-Coder-14B (4-bit) — solid coding model",
  },
  {
    minRAM: 0,
    modelId: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
    quantization: "4bit",
    estimatedSizeGB: 4,
    description: "Qwen2.5-Coder-7B (4-bit) — compact coding model",
  },
];

export async function getDeviceInfo(): Promise<DeviceInfo> {
  const { stdout: chipOut } = await execFileAsync("sysctl", ["-n", "machdep.cpu.brand_string"]);
  const { stdout: memOut } = await execFileAsync("sysctl", ["-n", "hw.memsize"]);
  const totalBytes = parseInt(memOut.trim(), 10);
  return {
    chip: chipOut.trim(),
    totalMemoryGB: Math.round(totalBytes / (1024 ** 3)),
  };
}

export function recommendModel(totalMemoryGB: number): ModelRecommendation {
  const budget = totalMemoryGB * 0.75;
  for (const tier of MODEL_TIERS) {
    if (totalMemoryGB >= tier.minRAM && budget >= tier.estimatedSizeGB) {
      return tier;
    }
  }
  return MODEL_TIERS[MODEL_TIERS.length - 1];
}
