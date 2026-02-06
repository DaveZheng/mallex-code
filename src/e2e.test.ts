import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { loadConfig } from "./config.js";
import { isServerHealthy } from "./server.js";
import { startProxy } from "./proxy.js";

describe("e2e proxy test", { skip: !process.env.MLX_E2E }, () => {
  let proxyServer: http.Server;
  let proxyPort: number;
  let model: string;

  before(async () => {
    const config = loadConfig();
    model = config.model;
    const serverPort = config.serverPort;
    // Use a different port for test proxy to avoid conflicts
    proxyPort = config.proxyPort + 1000;

    if (!model) {
      throw new Error("No model configured in ~/.mallex/config.json — run mallex first");
    }

    const healthy = await isServerHealthy(serverPort);
    if (!healthy) {
      throw new Error(`mlx-lm server not running on port ${serverPort} — start it first`);
    }

    proxyServer = await startProxy({ proxyPort, serverPort, model });
  });

  after(() => {
    if (proxyServer) proxyServer.close();
  });

  it("returns valid Anthropic response for a simple message", async () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: "You are a helpful assistant. Respond briefly.",
      messages: [
        { role: "user", content: "Say hello in exactly 3 words." },
      ],
      stream: false,
    });

    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json() as any;

    // Validate Anthropic response shape
    assert.strictEqual(data.type, "message");
    assert.strictEqual(data.role, "assistant");
    assert.ok(data.id.startsWith("msg_local_"));
    assert.ok(Array.isArray(data.content));
    assert.ok(data.content.length > 0);
    assert.ok(["end_turn", "tool_use", "max_tokens"].includes(data.stop_reason));
    assert.ok(data.content[0].type === "text");
    assert.ok(typeof data.content[0].text === "string");
  });

  it("returns valid Anthropic SSE stream for a streaming request", async () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: "You are a helpful assistant. Respond briefly.",
      messages: [
        { role: "user", content: "Say hello in exactly 3 words." },
      ],
      stream: true,
    });

    const res = await fetch(`http://localhost:${proxyPort}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));

    const text = await res.text();
    const events = text.split("\n\n").filter(Boolean);

    // Should start with message_start
    assert.ok(events[0].includes("event: message_start"), "should start with message_start");

    // Should end with message_stop
    assert.ok(events[events.length - 1].includes("event: message_stop"), "should end with message_stop");

    // Should contain at least one content_block_delta
    const hasDelta = events.some((e) => e.includes("event: content_block_delta"));
    assert.ok(hasDelta, "should have content_block_delta events");
  });

  it("returns 404 for non-messages endpoints", async () => {
    const res = await fetch(`http://localhost:${proxyPort}/v1/models`);
    assert.strictEqual(res.status, 404);
  });
});
