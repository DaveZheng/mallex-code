import { spawn, execFileSync, ChildProcess } from "node:child_process";
import { openSync, closeSync, readSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Spinner } from "./spinner.js";

const MALLEX_DIR = path.join(os.homedir(), ".mallex");
const PID_FILE = path.join(MALLEX_DIR, "server.pid");
const LOG_FILE = path.join(MALLEX_DIR, "server.log");
const PREV_LOG_FILE = path.join(MALLEX_DIR, "server.prev.log");
const MAX_LOG_BYTES = 512 * 1024; // 512KB
const VENV_PYTHON = path.join(MALLEX_DIR, "venv", "bin", "python3");

const VENV_DIR = path.join(MALLEX_DIR, "venv");
const VENV_PIP = path.join(VENV_DIR, "bin", "pip3");

// ── Phase-aware startup types & constants ──────────────────────────

export type ServerPhase = "starting" | "downloading" | "loading" | "ready";
export type LogSignal = "download_activity" | "httpd_started";

export const DEFAULT_PHASE_TIMEOUTS = {
  starting: 30_000,         // 30s — should see log activity quickly
  downloading: 30 * 60_000, // 30min — large models can be 5-20GB
  loading: 5 * 60_000,      // 5min — even 70B loads in <5min
  postHttpd: 30_000,        // 30s — health check after httpd message
};

const PHASE_PATTERNS = {
  downloading: [/Fetching \d+ files/, /Downloading/i, /\d+%\|/],
  httpdStarted: /Starting httpd at .+ on port \d+/,
};

export function classifyLogLine(line: string): LogSignal | null {
  if (PHASE_PATTERNS.httpdStarted.test(line)) return "httpd_started";
  for (const pat of PHASE_PATTERNS.downloading) {
    if (pat.test(line)) return "download_activity";
  }
  return null;
}

// ── LogTailer ──────────────────────────────────────────────────────

export class LogTailer {
  private fd: number | null = null;
  private offset = 0;
  private partial = "";
  private filePath: string;

  constructor(filePath: string = LOG_FILE) {
    this.filePath = filePath;
  }

  readNewLines(): string[] {
    if (this.fd === null) {
      try {
        this.fd = openSync(this.filePath, "r");
      } catch {
        return [];
      }
    }

    const buf = Buffer.alloc(8192);
    const lines: string[] = [];

    for (;;) {
      const bytesRead = readSync(this.fd, buf, 0, buf.length, this.offset);
      if (bytesRead === 0) break;
      this.offset += bytesRead;

      const chunk = buf.toString("utf-8", 0, bytesRead);
      const parts = (this.partial + chunk).split("\n");
      // Last element is either empty (line ended with \n) or a partial line
      this.partial = parts.pop()!;
      for (const line of parts) {
        if (line.length > 0) lines.push(line);
      }
    }

    return lines;
  }

  close(): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }
}

// ── Wait options & callbacks ───────────────────────────────────────

export interface WaitCallbacks {
  onPhaseChange?: (phase: ServerPhase) => void;
  onProgress?: (line: string) => void;
  onStaleWarning?: () => void;
}

export interface WaitOptions {
  timeouts?: Partial<typeof DEFAULT_PHASE_TIMEOUTS>;
  callbacks?: WaitCallbacks;
  logFile?: string;
  pollIntervalMs?: number;
  staleThresholdMs?: number;
}

// ── Existing helpers ───────────────────────────────────────────────

export function getPythonPath(): string {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return "python3";
}

/**
 * Find a working system python3 (≥3.10).
 * Checks PATH first, then pyenv versions and Homebrew paths
 * (pyenv shims can hide installed versions when global is set to system).
 * Throws with install instructions if not found.
 */
function findSystemPython(): string {
  const candidates = [
    "python3",
    "python",
  ];

  // Discover pyenv-installed versions (bypasses shims)
  const pyenvRoot = path.join(os.homedir(), ".pyenv", "versions");
  if (fs.existsSync(pyenvRoot)) {
    try {
      const versions = fs.readdirSync(pyenvRoot)
        .filter(v => /^3\.\d+/.test(v))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const v of versions) {
        candidates.push(path.join(pyenvRoot, v, "bin", "python3"));
      }
    } catch { /* can't read pyenv dir */ }
  }

  // Discover Homebrew-installed versions (Apple Silicon / Intel)
  for (const prefix of ["/opt/homebrew/opt", "/usr/local/opt"]) {
    if (!fs.existsSync(prefix)) continue;
    try {
      const pythons = fs.readdirSync(prefix)
        .filter(d => /^python@3\.\d+$/.test(d))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const d of pythons) {
        candidates.push(path.join(prefix, d, "bin", "python3"));
      }
    } catch { /* can't read brew dir */ }
  }

  let foundVersion: string | undefined;
  for (const cmd of candidates) {
    try {
      const version = execFileSync(cmd, ["--version"], { encoding: "utf-8" }).trim();
      const match = version.match(/Python (\d+)\.(\d+)/);
      if (match && parseInt(match[1]) >= 3 && parseInt(match[2]) >= 10) {
        return cmd;
      }
      if (!foundVersion && match && parseInt(match[1]) >= 3) {
        foundVersion = version;
      }
    } catch { /* not found, try next */ }
  }

  if (foundVersion) {
    throw new Error(
      `Found ${foundVersion} but mlx-lm requires Python 3.10+. Install with:\n` +
      `  brew install python@3.12`,
    );
  }
  throw new Error(
    `Python 3 not found. Install with:\n` +
    `  brew install python@3.12`,
  );
}

/**
 * Run a child process and return a promise that resolves on exit 0.
 * Collects stderr for error reporting.
 */
function spawnAsync(
  cmd: string,
  args: string[],
  opts?: { env?: NodeJS.ProcessEnv; onStdout?: (line: string) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1", ...opts?.env },
    });

    let stderrBuf = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      if (!opts?.onStdout) return;
      const lines = chunk.toString("utf-8").split("\n");
      for (const line of lines) {
        if (line.trim()) opts.onStdout(line);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf-8");
      // Keep only last 2KB
      if (stderrBuf.length > 2048) stderrBuf = stderrBuf.slice(-2048);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(
        `Command failed with exit code ${code}\n${stderrBuf.slice(-500)}`,
      ));
    });
  });
}

/**
 * Ensure the mallex venv exists and mlx-lm is installed.
 * Creates ~/.mallex/venv/ automatically on first run.
 */
export async function ensureDependencies(): Promise<void> {
  // If venv already has mlx-lm, we're good
  if (fs.existsSync(VENV_PYTHON)) {
    try {
      execFileSync(VENV_PYTHON, ["-c", "import mlx_lm"], { stdio: "ignore" });
      return;
    } catch { /* mlx-lm missing from venv, reinstall below */ }
  }

  const systemPython = findSystemPython();
  const spinner = new Spinner();

  // Create venv if it doesn't exist
  if (!fs.existsSync(VENV_PYTHON)) {
    spinner.start("Creating Python environment...");
    fs.mkdirSync(MALLEX_DIR, { recursive: true });
    try {
      await spawnAsync(systemPython, ["-m", "venv", VENV_DIR]);
      spinner.succeed("Python environment created");
    } catch (err) {
      spinner.fail("Failed to create Python environment");
      throw err;
    }
  }

  // Install mlx-lm into the venv
  spinner.start("Installing mlx-lm...");
  try {
    await spawnAsync(VENV_PIP, ["install", "--progress-bar", "off", "mlx-lm"], {
      onStdout(line) {
        const collecting = line.match(/^Collecting (\S+)/);
        if (collecting) {
          spinner.update(`Installing ${collecting[1]}...`);
          return;
        }
        const downloading = line.match(/^Downloading (\S+)/);
        if (downloading) {
          const pkg = downloading[1].split("/").pop()?.split("-")[0] ?? downloading[1];
          spinner.update(`Downloading ${pkg}...`);
        }
      },
    });
    spinner.succeed("Dependencies installed");
  } catch (err) {
    spinner.fail("Failed to install dependencies");
    throw err;
  }

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

/**
 * Write a Python wrapper that dynamically sets the MLX Metal cache limit
 * before starting the server. mlx-lm.server doesn't expose a cache limit
 * CLI flag, and the MLX default (~95% of device RAM) causes runaway growth.
 *
 * The wrapper computes: min(25% of max_recommended_working_set_size, 4GB),
 * floored at 256MB. This scales with the device while leaving headroom
 * for model weights and the OS.
 */
function ensureServerWrapper(): string {
  const wrapperPath = path.join(MALLEX_DIR, "server_wrapper.py");
  const script = `\
import mlx.core as mx

info = mx.device_info()
wss = info["max_recommended_working_set_size"]
cache_limit = min(max(wss // 4, 256 * 1024**2), 4 * 1024**3)
mx.set_cache_limit(cache_limit)

from mlx_lm.server import main
main()
`;
  fs.mkdirSync(MALLEX_DIR, { recursive: true });
  fs.writeFileSync(wrapperPath, script);
  return wrapperPath;
}

export function buildServerArgs(model: string, port: number): string[] {
  const wrapper = ensureServerWrapper();
  return [
    wrapper,
    "--model", model,
    "--port", String(port),
    "--prompt-concurrency", "1",
    "--decode-concurrency", "1",
  ];
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

/**
 * Rotate the server log: keep the tail of the previous log as server.prev.log
 * (capped at MAX_LOG_BYTES) so crash evidence survives restarts.
 */
function rotateLog(): void {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 0) {
      if (stat.size <= MAX_LOG_BYTES) {
        fs.copyFileSync(LOG_FILE, PREV_LOG_FILE);
      } else {
        // Keep only the last MAX_LOG_BYTES
        const fd = openSync(LOG_FILE, "r");
        const buf = Buffer.alloc(MAX_LOG_BYTES);
        readSync(fd, buf, 0, MAX_LOG_BYTES, stat.size - MAX_LOG_BYTES);
        closeSync(fd);
        fs.writeFileSync(PREV_LOG_FILE, buf);
      }
    }
  } catch {
    // Missing log is fine
  }
}

export async function startServer(model: string, port: number): Promise<number> {
  const args = buildServerArgs(model, port);
  const pythonPath = getPythonPath();
  fs.mkdirSync(MALLEX_DIR, { recursive: true });
  rotateLog();
  const logFd = openSync(LOG_FILE, "w");
  const child = spawn(pythonPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();

  const pid = child.pid;
  if (!pid) throw new Error("Failed to start mlx-lm server");

  fs.writeFileSync(PID_FILE, String(pid) + "\n");

  return pid;
}

// ── Phase-aware waitForServer ──────────────────────────────────────

export async function waitForServer(
  port: number,
  optionsOrTimeoutMs?: number | WaitOptions,
): Promise<void> {
  // Backward compat: bare number becomes a flat timeout for all phases
  const opts: WaitOptions =
    typeof optionsOrTimeoutMs === "number"
      ? { timeouts: {
          starting: optionsOrTimeoutMs,
          downloading: optionsOrTimeoutMs,
          loading: optionsOrTimeoutMs,
          postHttpd: optionsOrTimeoutMs,
        }}
      : optionsOrTimeoutMs ?? {};

  const timeouts = { ...DEFAULT_PHASE_TIMEOUTS, ...opts.timeouts };
  const pollMs = opts.pollIntervalMs ?? 1000;
  const staleMs = opts.staleThresholdMs ?? 30_000;
  const callbacks = opts.callbacks;
  const tailer = new LogTailer(opts.logFile);

  let phase: ServerPhase = "starting";
  let httpdSeen = false;
  let phaseStart = Date.now();
  let lastLogActivity = Date.now();
  let staleWarned = false;

  const setPhase = (newPhase: ServerPhase) => {
    if (newPhase === phase) return;
    phase = newPhase;
    phaseStart = Date.now();
    staleWarned = false;
    callbacks?.onPhaseChange?.(phase);
  };

  const currentTimeout = () => {
    if (httpdSeen) return timeouts.postHttpd;
    return timeouts[phase === "ready" ? "postHttpd" : phase];
  };

  try {
    for (;;) {
      // Health check first
      if (await isServerHealthy(port)) {
        setPhase("ready");
        return;
      }

      // Read new log lines
      const lines = tailer.readNewLines();
      if (lines.length > 0) {
        lastLogActivity = Date.now();
        staleWarned = false;
      }

      for (const line of lines) {
        const signal = classifyLogLine(line);
        const cur = phase; // snapshot — setPhase mutates `phase`

        if (cur === "starting") {
          if (signal === "download_activity") {
            setPhase("downloading");
            callbacks?.onProgress?.(line);
          } else if (signal === "httpd_started") {
            httpdSeen = true;
            setPhase("loading");
          } else {
            // Any log output → model is loading (already cached)
            setPhase("loading");
          }
        } else if (cur === "downloading") {
          if (signal === "httpd_started") {
            httpdSeen = true;
            setPhase("loading");
          } else if (signal === "download_activity") {
            callbacks?.onProgress?.(line);
          } else {
            // Non-download line after downloads → loading phase
            setPhase("loading");
          }
        } else if (cur === "loading") {
          if (signal === "httpd_started") {
            httpdSeen = true;
            phaseStart = Date.now(); // reset timer to postHttpd
          }
        }
      }

      // Stale detection
      if (!staleWarned && Date.now() - lastLogActivity > staleMs && phase !== "starting") {
        staleWarned = true;
        callbacks?.onStaleWarning?.();
      }

      // Phase timeout
      if (Date.now() - phaseStart > currentTimeout()) {
        throw new Error(
          `Server timed out during "${phase}" phase after ${Math.round(currentTimeout() / 1000)}s`,
        );
      }

      await new Promise((r) => setTimeout(r, pollMs));
    }
  } finally {
    tailer.close();
  }
}

// ── ensureServer with progress UX ──────────────────────────────────

export async function ensureServer(model: string, port: number): Promise<void> {
  if (await isServerHealthy(port)) return;

  // A previous session left the server running (e.g. user chose "keep alive").
  // Don't spawn a duplicate — just wait for the existing process.
  const existingPid = getRunningServerPid();

  const spinner = new Spinner();
  if (existingPid) {
    spinner.start("Waiting for existing MLX server...");
  } else {
    spinner.start("Starting MLX server...");
    await startServer(model, port);
  }

  await waitForServer(port, {
    callbacks: {
      onPhaseChange(phase) {
        switch (phase) {
          case "downloading":
            // Stop spinner — mlx-lm has its own tqdm progress bars
            spinner.stop();
            console.log("Downloading model (first run — this may take a while)...");
            break;
          case "loading":
            spinner.start("Loading model into memory...");
            break;
          case "ready":
            spinner.succeed("Server ready");
            break;
        }
      },
      onProgress(line) {
        process.stderr.write(line + "\r");
      },
      onStaleWarning() {
        spinner.update("Loading model into memory... (no activity for 30s)");
      },
    },
  });
}

const OOM_PATTERNS = [
  "out of memory",
  "memoryerror",
  "cannot allocate memory",
  "failed to allocate",
  "mlock failed",
];

export function isOomCrash(): boolean {
  try {
    const log = fs.readFileSync(LOG_FILE, "utf-8");
    // Check the last 2KB for OOM indicators
    const tail = log.slice(-2048).toLowerCase();
    return OOM_PATTERNS.some((p) => tail.includes(p));
  } catch {
    return false;
  }
}

/**
 * Check if a server process from a previous session is still alive.
 * Returns the PID if the process exists, null otherwise.
 */
export function getRunningServerPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null;
  const pid = parseServerPid(fs.readFileSync(PID_FILE, "utf-8"));
  if (!pid) return null;
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't kill
    return pid;
  } catch {
    // Process doesn't exist — stale PID file
    fs.unlinkSync(PID_FILE);
    return null;
  }
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
