import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {
  buildServerArgs,
  parseServerPid,
  classifyLogLine,
  LogTailer,
  waitForServer,
} from "./server.js";
import type { ServerPhase, WaitOptions } from "./server.js";

describe("buildServerArgs", () => {
  it("uses wrapper script with concurrency limits", () => {
    const args = buildServerArgs("mlx-community/test-model", 8080);
    assert.ok(args[0].endsWith("server_wrapper.py"), "should use wrapper script");
    assert.deepStrictEqual(args.slice(1), [
      "--model", "mlx-community/test-model",
      "--port", "8080",
      "--prompt-concurrency", "1",
      "--decode-concurrency", "1",
    ]);
    // Wrapper script should exist and set cache limit
    const wrapper = fs.readFileSync(args[0], "utf-8");
    assert.ok(wrapper.includes("set_cache_limit"), "wrapper should set cache limit");
  });
});

describe("parseServerPid", () => {
  it("parses a valid PID file", () => {
    assert.strictEqual(parseServerPid("12345\n"), 12345);
  });

  it("returns null for empty content", () => {
    assert.strictEqual(parseServerPid(""), null);
  });

  it("returns null for non-numeric content", () => {
    assert.strictEqual(parseServerPid("not-a-pid"), null);
  });
});

// ── classifyLogLine ────────────────────────────────────────────────

describe("classifyLogLine", () => {
  it("detects Fetching files line", () => {
    assert.strictEqual(
      classifyLogLine("Fetching 9 files: 100%|██████████| 9/9"),
      "download_activity",
    );
  });

  it("detects Downloading line", () => {
    assert.strictEqual(
      classifyLogLine("Downloading model.safetensors"),
      "download_activity",
    );
  });

  it("detects tqdm progress bar", () => {
    assert.strictEqual(
      classifyLogLine("  45%|████▌     | 2.1G/4.7G [01:23<01:42, 25.4MB/s]"),
      "download_activity",
    );
  });

  it("detects httpd started line", () => {
    assert.strictEqual(
      classifyLogLine("Starting httpd at http://127.0.0.1 on port 8081"),
      "httpd_started",
    );
  });

  it("returns null for unrelated lines", () => {
    assert.strictEqual(classifyLogLine("Loading model from disk..."), null);
    assert.strictEqual(classifyLogLine("INFO: some random log"), null);
    assert.strictEqual(classifyLogLine(""), null);
  });

  it("prioritizes httpd_started over download patterns", () => {
    // Unlikely but httpd line should win since it's checked first
    assert.strictEqual(
      classifyLogLine("Starting httpd at http://127.0.0.1 on port 8081 Downloading"),
      "httpd_started",
    );
  });
});

// ── LogTailer ──────────────────────────────────────────────────────

describe("LogTailer", () => {
  let tmpFile: string;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it("returns [] when file doesn't exist", () => {
    const tailer = new LogTailer("/tmp/nonexistent-log-" + Date.now());
    assert.deepStrictEqual(tailer.readNewLines(), []);
    tailer.close();
  });

  it("reads initial content", () => {
    tmpFile = path.join(os.tmpdir(), `logtailer-test-${Date.now()}`);
    fs.writeFileSync(tmpFile, "line1\nline2\n");
    const tailer = new LogTailer(tmpFile);
    assert.deepStrictEqual(tailer.readNewLines(), ["line1", "line2"]);
    tailer.close();
  });

  it("reads only new content on subsequent calls", () => {
    tmpFile = path.join(os.tmpdir(), `logtailer-test-${Date.now()}`);
    fs.writeFileSync(tmpFile, "line1\n");
    const tailer = new LogTailer(tmpFile);
    assert.deepStrictEqual(tailer.readNewLines(), ["line1"]);

    fs.appendFileSync(tmpFile, "line2\nline3\n");
    assert.deepStrictEqual(tailer.readNewLines(), ["line2", "line3"]);
    tailer.close();
  });

  it("buffers partial lines until newline arrives", () => {
    tmpFile = path.join(os.tmpdir(), `logtailer-test-${Date.now()}`);
    fs.writeFileSync(tmpFile, "partial");
    const tailer = new LogTailer(tmpFile);
    assert.deepStrictEqual(tailer.readNewLines(), []);

    fs.appendFileSync(tmpFile, " line\n");
    assert.deepStrictEqual(tailer.readNewLines(), ["partial line"]);
    tailer.close();
  });

  it("handles empty reads when no new content", () => {
    tmpFile = path.join(os.tmpdir(), `logtailer-test-${Date.now()}`);
    fs.writeFileSync(tmpFile, "line1\n");
    const tailer = new LogTailer(tmpFile);
    tailer.readNewLines(); // consume
    assert.deepStrictEqual(tailer.readNewLines(), []);
    assert.deepStrictEqual(tailer.readNewLines(), []);
    tailer.close();
  });
});

// ── waitForServer integration ──────────────────────────────────────

describe("waitForServer", () => {
  let tmpLog: string;
  let httpServer: http.Server | null = null;

  afterEach(async () => {
    if (tmpLog && fs.existsSync(tmpLog)) fs.unlinkSync(tmpLog);
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = null;
    }
  });

  function startMockServer(port: number): Promise<void> {
    return new Promise((resolve) => {
      httpServer = http.createServer((req, res) => {
        if (req.url === "/v1/models") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ data: [] }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      httpServer.listen(port, () => resolve());
    });
  }

  it("transitions through downloading → loading → ready", async () => {
    const port = 18901 + Math.floor(Math.random() * 100);
    tmpLog = path.join(os.tmpdir(), `waitserver-test-${Date.now()}`);
    fs.writeFileSync(tmpLog, "");

    const phases: ServerPhase[] = [];
    const progressLines: string[] = [];

    const opts: WaitOptions = {
      logFile: tmpLog,
      pollIntervalMs: 50,
      staleThresholdMs: 60_000, // don't trigger stale in tests
      timeouts: { starting: 5000, downloading: 5000, loading: 5000, postHttpd: 5000 },
      callbacks: {
        onPhaseChange(phase) { phases.push(phase); },
        onProgress(line) { progressLines.push(line); },
      },
    };

    // Simulate: download lines appear, then httpd, then server becomes healthy
    setTimeout(() => {
      fs.appendFileSync(tmpLog, "Fetching 9 files: 100%|██████████| 9/9\n");
    }, 100);
    setTimeout(() => {
      fs.appendFileSync(tmpLog, "Starting httpd at http://127.0.0.1 on port " + port + "\n");
    }, 200);
    setTimeout(() => startMockServer(port), 300);

    await waitForServer(port, opts);

    assert.ok(phases.includes("downloading"), "should enter downloading phase");
    assert.ok(phases.includes("loading"), "should enter loading phase");
    assert.ok(phases.includes("ready"), "should reach ready phase");
    assert.ok(progressLines.length > 0, "should relay download progress");
  });

  it("skips downloading when model is cached", async () => {
    const port = 19001 + Math.floor(Math.random() * 100);
    tmpLog = path.join(os.tmpdir(), `waitserver-test-${Date.now()}`);
    fs.writeFileSync(tmpLog, "");

    const phases: ServerPhase[] = [];

    const opts: WaitOptions = {
      logFile: tmpLog,
      pollIntervalMs: 50,
      staleThresholdMs: 60_000,
      timeouts: { starting: 5000, downloading: 5000, loading: 5000, postHttpd: 5000 },
      callbacks: {
        onPhaseChange(phase) { phases.push(phase); },
      },
    };

    // Simulate: non-download log lines, then httpd, then healthy
    setTimeout(() => {
      fs.appendFileSync(tmpLog, "Loading model from /path/to/model\n");
    }, 100);
    setTimeout(() => {
      fs.appendFileSync(tmpLog, "Starting httpd at http://127.0.0.1 on port " + port + "\n");
    }, 200);
    setTimeout(() => startMockServer(port), 300);

    await waitForServer(port, opts);

    assert.ok(!phases.includes("downloading"), "should not enter downloading phase");
    assert.ok(phases.includes("loading"), "should enter loading phase");
    assert.ok(phases.includes("ready"), "should reach ready phase");
  });

  it("throws on starting timeout (no log output)", async () => {
    const port = 19101 + Math.floor(Math.random() * 100);
    tmpLog = path.join(os.tmpdir(), `waitserver-test-${Date.now()}`);
    fs.writeFileSync(tmpLog, "");

    const opts: WaitOptions = {
      logFile: tmpLog,
      pollIntervalMs: 50,
      staleThresholdMs: 60_000,
      timeouts: { starting: 200, downloading: 200, loading: 200, postHttpd: 200 },
    };

    await assert.rejects(
      () => waitForServer(port, opts),
      (err: Error) => {
        assert.match(err.message, /timed out during "starting"/);
        return true;
      },
    );
  });

  it("throws on loading timeout (httpd never appears)", async () => {
    const port = 19201 + Math.floor(Math.random() * 100);
    tmpLog = path.join(os.tmpdir(), `waitserver-test-${Date.now()}`);
    fs.writeFileSync(tmpLog, "");

    const opts: WaitOptions = {
      logFile: tmpLog,
      pollIntervalMs: 50,
      staleThresholdMs: 60_000,
      timeouts: { starting: 5000, downloading: 5000, loading: 300, postHttpd: 300 },
    };

    // Write a non-download log line to move past starting, then nothing
    setTimeout(() => {
      fs.appendFileSync(tmpLog, "Initializing model...\n");
    }, 50);

    await assert.rejects(
      () => waitForServer(port, opts),
      (err: Error) => {
        assert.match(err.message, /timed out during "loading"/);
        return true;
      },
    );
  });

  it("backward compat: accepts a bare number as flat timeout", async () => {
    const port = 19301 + Math.floor(Math.random() * 100);

    // No log file (default path won't exist), should timeout with the given ms
    await assert.rejects(
      () => waitForServer(port, 300),
      (err: Error) => {
        assert.match(err.message, /timed out/);
        return true;
      },
    );
  });
});
