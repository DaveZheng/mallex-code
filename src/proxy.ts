/**
 * HTTP proxy server that accepts Anthropic Messages API requests
 * and translates them to/from OpenAI Chat Completions for mlx-lm.server.
 */

import http from "node:http";
import { translateRequest, type AnthropicRequest } from "./translate-request.js";
import { translateResponse } from "./translate-response.js";
import { chatCompletion, chatCompletionStream } from "./client.js";
import { createStreamTranslator } from "./translate-stream.js";

export interface ProxyOptions {
  proxyPort: number;
  serverPort: number;
  model: string;
}

/**
 * Start the translation proxy server.
 * Returns the HTTP server instance (for testing/lifecycle management).
 */
export function startProxy(options: ProxyOptions): http.Server {
  const { proxyPort, serverPort, model } = options;

  const server = http.createServer(async (req, res) => {
    // Only handle POST /v1/messages
    if (req.method !== "POST" || req.url !== "/v1/messages") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { type: "not_found", message: "Not found" } }));
      return;
    }

    try {
      const body = await readBody(req);
      const anthropicReq: AnthropicRequest = JSON.parse(body);
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

  server.listen(proxyPort, () => {
    console.log(`mallex-proxy listening on http://localhost:${proxyPort}`);
    console.log(`  forwarding to mlx-lm.server on port ${serverPort}`);
    console.log(`  model: ${model}`);
  });

  return server;
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
