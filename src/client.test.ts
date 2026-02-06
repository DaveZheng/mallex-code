import { describe, it } from "node:test";
import assert from "node:assert";
import type { OpenAIChatRequest, OpenAIChatResponse } from "./client.js";

describe("OpenAIChatRequest", () => {
  it("accepts a well-formed request body", () => {
    const body: OpenAIChatRequest = {
      model: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
      max_tokens: 4096,
      temperature: 0.7,
      top_p: 0.95,
    };
    assert.strictEqual(body.model, "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
    assert.strictEqual(body.messages.length, 2);
    assert.strictEqual(body.stream, undefined);
  });
});

describe("OpenAIChatResponse", () => {
  it("matches expected mlx-lm.server response shape", () => {
    const response: OpenAIChatResponse = {
      id: "chatcmpl-123",
      choices: [
        {
          message: { role: "assistant", content: "Hello! Let me help." },
          finish_reason: "stop",
          index: 0,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    assert.strictEqual(response.choices[0].message.content, "Hello! Let me help.");
    assert.strictEqual(response.choices[0].finish_reason, "stop");
  });
});
