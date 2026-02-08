/**
 * Anthropic API client using node:https (zero external dependencies).
 * Used by the routing proxy to forward requests that are too complex for local MLX.
 */

import https from "node:https";
import type { ServerResponse } from "node:http";

const ANTHROPIC_HOST = "api.anthropic.com";
const ANTHROPIC_PATH = "/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class ClaudeApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ClaudeApiError";
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isOverloaded(): boolean {
    return this.status === 529;
  }
}

/**
 * Send a non-streaming chat completion request to the Anthropic Messages API.
 * Returns the raw JSON response body string.
 */
export function claudeCompletion(
  anthropicReq: object,
  options: { apiKey: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(anthropicReq);

    const req = https.request(
      {
        hostname: ANTHROPIC_HOST,
        path: ANTHROPIC_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf-8");
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new ClaudeApiError(responseBody, status));
            return;
          }
          resolve(responseBody);
        });
      },
    );

    req.on("error", (err) => {
      reject(new Error(`Anthropic API network error: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Send a streaming chat completion request to the Anthropic Messages API.
 * Pipes the SSE response directly to the provided ServerResponse.
 */
export function claudeCompletionStream(
  anthropicReq: object,
  options: { apiKey: string },
  clientRes: ServerResponse,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ...anthropicReq, stream: true });

    const req = https.request(
      {
        hostname: ANTHROPIC_HOST,
        path: ANTHROPIC_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (apiRes) => {
        const status = apiRes.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = [];
          apiRes.on("data", (chunk: Buffer) => chunks.push(chunk));
          apiRes.on("end", () => {
            const responseBody = Buffer.concat(chunks).toString("utf-8");
            reject(new ClaudeApiError(responseBody, status));
          });
          return;
        }

        clientRes.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        apiRes.pipe(clientRes);
        apiRes.on("end", () => resolve());
      },
    );

    req.on("error", (err) => {
      reject(new Error(`Anthropic API network error: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}
