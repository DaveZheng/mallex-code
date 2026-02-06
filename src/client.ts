/**
 * Outbound client for mlx-lm.server (OpenAI-compatible chat completions API).
 * Used by the translation proxy to forward requests.
 */

export interface OpenAIChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
  temperature: number;
  top_p: number;
  stream?: boolean;
  stop?: string[];
}

export interface OpenAIChatResponse {
  id: string;
  choices: {
    message: { role: string; content: string };
    finish_reason: string;
    index: number;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface OpenAIStreamChunk {
  id: string;
  choices: {
    delta: { role?: string; content?: string };
    finish_reason: string | null;
    index: number;
  }[];
}

/**
 * Send a non-streaming chat completion request to mlx-lm.server.
 */
export async function chatCompletion(
  body: OpenAIChatRequest,
  port: number,
): Promise<OpenAIChatResponse> {
  const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mlx-lm server error ${res.status}: ${text}`);
  }
  return await res.json() as OpenAIChatResponse;
}

/**
 * Send a streaming chat completion request to mlx-lm.server.
 * Returns a ReadableStream of parsed SSE chunks.
 */
export async function chatCompletionStream(
  body: OpenAIChatRequest,
  port: number,
): Promise<ReadableStream<OpenAIStreamChunk>> {
  const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mlx-lm server error ${res.status}: ${text}`);
  }
  if (!res.body) {
    throw new Error("No response body for streaming request");
  }

  return res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TransformStream<string, OpenAIStreamChunk>({
      buffer: "",
      transform(chunk, controller) {
        this.buffer += chunk;
        const lines = this.buffer.split("\n");
        // Keep the last potentially incomplete line in the buffer
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            controller.enqueue(JSON.parse(data));
          } catch {
            // Skip malformed JSON chunks
          }
        }
      },
      flush(controller) {
        // Process any remaining data in the buffer
        if (this.buffer.trim()) {
          const trimmed = this.buffer.trim();
          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            if (data !== "[DONE]") {
              try {
                controller.enqueue(JSON.parse(data));
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      },
    } as Transformer<string, OpenAIStreamChunk> & { buffer: string }));
}
