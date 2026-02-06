import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MALLEX_DIR = path.join(os.homedir(), ".mallex");
const PID_FILE = path.join(MALLEX_DIR, "server.pid");
const LOG_FILE = path.join(MALLEX_DIR, "server.log");
const VENV_PYTHON = path.join(MALLEX_DIR, "venv", "bin", "python3");

export function getPythonPath(): string {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return "python3";
}

export function buildServerArgs(model: string, port: number): string[] {
  return ["-m", "mlx_lm.server", "--model", model, "--port", String(port)];
}

export function parseServerPid(content: string): number | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const num = parseInt(trimmed, 10);
  return Number.isNaN(num) ? null : num;
}

export async function isServerHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/v1/models`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function startServer(model: string, port: number): Promise<number> {
  const args = buildServerArgs(model, port);
  const pythonPath = getPythonPath();
  fs.mkdirSync(MALLEX_DIR, { recursive: true });
  const logFd = openSync(LOG_FILE, "w");
  const child = spawn(pythonPath, args, {
    detached: true,
    stdio: ["ignore", "ignore", logFd],
  });
  child.unref();

  const pid = child.pid;
  if (!pid) throw new Error("Failed to start mlx-lm server");

  fs.writeFileSync(PID_FILE, String(pid) + "\n");

  return pid;
}

export async function waitForServer(port: number, timeoutMs: number = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerHealthy(port)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs / 1000}s`);
}

export async function ensureServer(model: string, port: number): Promise<void> {
  if (await isServerHealthy(port)) return;
  console.log("Starting MLX server...");
  await startServer(model, port);
  await waitForServer(port);
  console.log("Server ready.");
}

export function stopServer(): boolean {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = parseServerPid(fs.readFileSync(PID_FILE, "utf-8"));
  if (!pid) return false;
  try {
    process.kill(pid, "SIGTERM");
    fs.unlinkSync(PID_FILE);
    return true;
  } catch {
    fs.unlinkSync(PID_FILE);
    return false;
  }
}
