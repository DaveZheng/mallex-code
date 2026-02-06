import { describe, it } from "node:test";
import assert from "node:assert";
import { buildRequestBody, parseResponse, type ChatMessage } from "./client.js";

describe("buildRequestBody", () => {
  it("builds correct OpenAI chat completions request", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const body = buildRequestBody(messages, "test-model");
    assert.strictEqual(body.model, "test-model");
    assert.strictEqual(body.messages.length, 2);
    assert.strictEqual(body.messages[0].role, "system");
  });
});

describe("parseResponse", () => {
  it("extracts assistant content from OpenAI response", () => {
    const response = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello! Let me help.",
          },
          finish_reason: "stop",
        },
      ],
    };
    const result = parseResponse(response);
    assert.strictEqual(result.content, "Hello! Let me help.");
    assert.strictEqual(result.finishReason, "stop");
  });
});
