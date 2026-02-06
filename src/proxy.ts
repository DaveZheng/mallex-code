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

export interface ProxyOptions {
  proxyPort: number;
  serverPort: number;
  model: string;
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
      const openaiReq = translateRequest(anthropicReq, model);

      if (anthropicReq.stream) {
        await handleStreaming(openaiReq, model, serverPort, res);
      } else {
        await handleNonStreaming(openaiReq, model, serverPort, res);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: { type: "server_error", message } }));
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
