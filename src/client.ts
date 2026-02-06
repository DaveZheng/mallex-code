export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  top_p: number;
}

export interface ChatResponseParsed {
  content: string;
  finishReason: string;
}

export function buildRequestBody(
  messages: ChatMessage[],
  model: string,
  maxTokens: number = 4096,
): ChatRequestBody {
  return {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 0.95,
  };
}

export function parseResponse(response: any): ChatResponseParsed {
  const choice = response.choices?.[0];
  if (!choice) throw new Error("No choices in response");
  return {
    content: choice.message?.content ?? "",
    finishReason: choice.finish_reason ?? "stop",
  };
}

export async function chatCompletion(
  messages: ChatMessage[],
  model: string,
  port: number,
): Promise<ChatResponseParsed> {
  const body = buildRequestBody(messages, model);
  const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mlx-lm server error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return parseResponse(json);
}
