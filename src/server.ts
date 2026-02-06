import { spawn, execFileSync } from "node:child_process";
import { openSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MALLEX_DIR = path.join(os.homedir(), ".mallex");
const PID_FILE = path.join(MALLEX_DIR, "server.pid");
const LOG_FILE = path.join(MALLEX_DIR, "server.log");
const VENV_PYTHON = path.join(MALLEX_DIR, "venv", "bin", "python3");

const VENV_DIR = path.join(MALLEX_DIR, "venv");
const VENV_PIP = path.join(VENV_DIR, "bin", "pip3");

export function getPythonPath(): string {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return "python3";
}

/**
 * Find a working system python3 (≥3.10).
 * Throws with install instructions if not found.
 */
function findSystemPython(): string {
  for (const cmd of ["python3", "python"]) {
    try {
      const version = execFileSync(cmd, ["--version"], { encoding: "utf-8" }).trim();
      // "Python 3.12.1" → check major.minor
      const match = version.match(/Python (\d+)\.(\d+)/);
      if (match && parseInt(match[1]) >= 3 && parseInt(match[2]) >= 10) {
        return cmd;
      }
    } catch { /* not found, try next */ }
  }
  throw new Error(
    `Python 3.10+ not found. Install it with:\n` +
    `  brew install python@3.12\n` +
    `or visit https://www.python.org/downloads/`,
  );
}

/**
 * Ensure the mallex venv exists and mlx-lm is installed.
 * Creates ~/.mallex/venv/ automatically on first run.
 */
export function ensureDependencies(): void {
  // If venv already has mlx-lm, we're good
  if (fs.existsSync(VENV_PYTHON)) {
    try {
      execFileSync(VENV_PYTHON, ["-c", "import mlx_lm"], { stdio: "ignore" });
      return;
    } catch { /* mlx-lm missing from venv, reinstall below */ }
  }

  const systemPython = findSystemPython();

  // Create venv if it doesn't exist
  if (!fs.existsSync(VENV_PYTHON)) {
    console.log("Creating Python environment at ~/.mallex/venv/ ...");
    fs.mkdirSync(MALLEX_DIR, { recursive: true });
    execFileSync(systemPython, ["-m", "venv", VENV_DIR], { stdio: "inherit" });
  }

  // Install mlx-lm into the venv
  console.log("Installing mlx-lm (this may take a minute on first run)...");
  execFileSync(VENV_PIP, ["install", "mlx-lm"], { stdio: "inherit" });

  // Verify it worked
  try {
    execFileSync(VENV_PYTHON, ["-c", "import mlx_lm"], { stdio: "ignore" });
  } catch {
    throw new Error(
      `Failed to install mlx-lm. Try manually:\n` +
      `  ${VENV_PIP} install mlx-lm`,
    );
  }
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
