/**
 * HTTP proxy server that accepts Anthropic Messages API requests
 * and translates them to/from OpenAI Chat Completions for mlx-lm.server.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { translateRequest, type AnthropicRequest } from "./translate-request.js";
import { translateResponse } from "./translate-response.js";
import { chatCompletion, chatCompletionStream } from "./client.js";
import { createStreamTranslator } from "./translate-stream.js";
import { isServerHealthy, isOomCrash, startServer, waitForServer } from "./server.js";
import { loadConfig, type RoutingConfig } from "./config.js";
import { extractLatestUserText, classifyIntent, resolveRoute } from "./router.js";
import { claudeCompletion, claudeCompletionStream, ClaudeApiError } from "./claude-client.js";

function debugLogRequest(anthropicReq: AnthropicRequest): void {
  try {
    const dir = path.join(os.homedir(), ".mallex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "last-request.json"),
      JSON.stringify(anthropicReq, null, 2),
    );
  } catch {
    // Debug logging should never break the proxy
  }
}

class OomError extends Error {
  constructor() {
    super("mlx-lm server ran out of GPU memory. Free up memory (close other apps, reduce context), then retry your message.");
    this.name = "OomError";
  }
}

let shuttingDown = false;
export function setShuttingDown(): void { shuttingDown = true; }

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("network")
  );
}

async function withAutoRestart<T>(
  fn: () => Promise<T>,
  model: string,
  serverPort: number,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    if (shuttingDown) throw err;
    if (await isServerHealthy(serverPort)) throw err;

    if (isOomCrash()) {
      console.error("[mallex] mlx-lm server ran out of GPU memory");
      throw new OomError();
    }

    console.error("[mallex] mlx-lm server crashed, restarting...");
    await startServer(model, serverPort);
    await waitForServer(serverPort);
    console.error("[mallex] server restarted, retrying request");

    return fn();
  }
}

export interface ProxyOptions {
  proxyPort: number;
  serverPort: number;
  model: string;
  routing?: RoutingConfig;
}

/**
 * Start the translation proxy server.
 * Returns a promise that resolves with the HTTP server once it's listening.
 */
export function startProxy(options: ProxyOptions): Promise<http.Server> {
  const { proxyPort, serverPort, model } = options;

  const server = http.createServer(async (req, res) => {
    const pathname = req.url?.split("?")[0];

    // Handle token counting — Claude Code calls this to validate the model
    if (req.method === "POST" && pathname === "/v1/messages/count_tokens") {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const estimatedTokens = JSON.stringify(parsed.messages ?? []).length / 4;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ input_tokens: Math.ceil(estimatedTokens) }));
      return;
    }

    if (req.method !== "POST" || pathname !== "/v1/messages") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { type: "not_found", message: "Not found" } }));
      return;
    }

    try {
      const body = await readBody(req);
      const anthropicReq: AnthropicRequest = JSON.parse(body);
      debugLogRequest(anthropicReq);

      // Route via intent classification if routing is configured
      const routing = getRoutingConfig();
      if (routing) {
        const route = await routeRequest(anthropicReq, model, serverPort, routing);
        if (route?.target === "claude" && routing.claudeApiKey) {
          try {
            await handleClaudeRoute(anthropicReq, routing.claudeApiKey, route.claudeModel, res);
            return;
          } catch (err) {
            if (err instanceof ClaudeApiError) {
              console.error(`[mallex] Claude API error (${err.status}), falling back to local`);
            } else {
              console.error("[mallex] Claude API error, falling back to local");
            }
            // Fall through to local MLX path
          }
        }
      }

      const openaiReq = translateRequest(anthropicReq, model);

      if (anthropicReq.stream) {
        await withAutoRestart(
          () => handleStreaming(openaiReq, model, serverPort, res),
          model,
          serverPort,
        );
      } else {
        await withAutoRestart(
          () => handleNonStreaming(openaiReq, model, serverPort, res),
          model,
          serverPort,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      if (!res.headersSent) {
        if (err instanceof OomError) {
          res.writeHead(400, {
            "Content-Type": "application/json",
            "x-should-retry": "false",
          });
          res.end(JSON.stringify({ error: { type: "invalid_request_error", message } }));
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { type: "server_error", message } }));
        }
      } else {
        res.end();
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(proxyPort, () => {
      console.log(`mallex-proxy listening on http://localhost:${proxyPort}`);
      console.log(`  forwarding to mlx-lm.server on port ${serverPort}`);
      console.log(`  model: ${model}`);
      resolve(server);
    });
  });
}

/**
 * Re-read routing config from disk on each request so --setup changes take effect without restart.
 */
function getRoutingConfig(): RoutingConfig | undefined {
  try {
    const config = loadConfig();
    return config.routing;
  } catch {
    return undefined;
  }
}

/**
 * Classify the request and resolve a routing decision.
 * Returns null if classification should be skipped (no routing config, or all rules are tier 1).
 */
async function routeRequest(
  anthropicReq: AnthropicRequest,
  model: string,
  serverPort: number,
  routing: RoutingConfig,
) {
  // Skip classification if all rules are tier 1 (everything goes local)
  const allLocal = Object.values(routing.rules).every((r) => r.tier === 1);
  if (allLocal) return null;

  const userText = extractLatestUserText(anthropicReq.messages);
  if (!userText) return null;

  const intent = await classifyIntent(userText, model, serverPort);
  const route = resolveRoute(intent, routing.rules, routing.tiers);
  console.error(`[mallex] intent=${route.intent} tier=${route.tier} target=${route.target}`);
  return route;
}

/**
 * Forward an Anthropic request directly to Claude API (no translation needed).
 */
async function handleClaudeRoute(
  anthropicReq: AnthropicRequest,
  apiKey: string,
  claudeModel: string | undefined,
  res: http.ServerResponse,
): Promise<void> {
  // Override the model with the tier's configured Claude model
  const req = claudeModel ? { ...anthropicReq, model: claudeModel } : anthropicReq;
  if (req.stream) {
    await claudeCompletionStream(req, { apiKey }, res);
  } else {
    const responseBody = await claudeCompletion(req, { apiKey });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(responseBody);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function handleNonStreaming(
  openaiReq: ReturnType<typeof translateRequest>,
  model: string,
  serverPort: number,
  res: http.ServerResponse,
): Promise<void> {
  const openaiRes = await chatCompletion(openaiReq, serverPort);
  const content = openaiRes.choices?.[0]?.message?.content ?? "";
  const anthropicRes = translateResponse(content, model);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(anthropicRes));
}

async function handleStreaming(
  openaiReq: ReturnType<typeof translateRequest>,
  model: string,
  serverPort: number,
  res: http.ServerResponse,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const stream = await chatCompletionStream(openaiReq, serverPort);
  const translator = createStreamTranslator(model);
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const events = translator.push(value);
      if (events) res.write(events);
    }
  } finally {
    const finalEvents = translator.finish();
    if (finalEvents) res.write(finalEvents);
    res.end();
  }
}
