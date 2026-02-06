import { describe, it } from "node:test";
import assert from "node:assert";
import { createStreamTranslator } from "./translate-stream.js";
import type { OpenAIStreamChunk } from "./client.js";

function makeChunk(content: string, finishReason: string | null = null): OpenAIStreamChunk {
  return {
    id: "chatcmpl-test",
    choices: [{
      delta: { content },
      finish_reason: finishReason,
      index: 0,
    }],
  };
}

function parseEvents(output: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const blocks = output.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event: "));
    const dataLine = lines.find((l) => l.startsWith("data: "));
    if (eventLine && dataLine) {
      events.push({
        event: eventLine.slice(7),
        data: JSON.parse(dataLine.slice(6)),
      });
    }
  }
  return events;
}

describe("createStreamTranslator", () => {
  const model = "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit";

  it("emits message_start on first chunk", () => {
    const translator = createStreamTranslator(model);
    const output = translator.push(makeChunk("Hello"));
    const events = parseEvents(output);
    assert.strictEqual(events[0].event, "message_start");
    assert.strictEqual(events[0].data.message.role, "assistant");
    assert.strictEqual(events[0].data.message.model, model);
  });

  it("emits text deltas for plain text", () => {
    const translator = createStreamTranslator(model);
    translator.push(makeChunk("Hello"));
    const output2 = translator.push(makeChunk(" world"));
    const events = parseEvents(output2);
    const delta = events.find((e) => e.event === "content_block_delta");
    assert.ok(delta);
    assert.strictEqual(delta.data.delta.text, " world");
  });

  it("emits message_stop on finish with no tool calls", () => {
    const translator = createStreamTranslator(model);
    translator.push(makeChunk("Hello"));
    const output = translator.finish();
    const events = parseEvents(output);
    const stop = events.find((e) => e.event === "content_block_stop");
    assert.ok(stop, "should have content_block_stop");
    const msgDelta = events.find((e) => e.event === "message_delta");
    assert.ok(msgDelta);
    assert.strictEqual(msgDelta.data.delta.stop_reason, "end_turn");
    const msgStop = events.find((e) => e.event === "message_stop");
    assert.ok(msgStop);
  });

  it("emits tool_use blocks when tool calls are found in accumulated text", () => {
    const translator = createStreamTranslator(model);
    translator.push(makeChunk("Let me read that.\n\n"));
    translator.push(makeChunk("<tool_call>\n"));
    translator.push(makeChunk("<function=Read>\n"));
    translator.push(makeChunk("<parameter=file_path>src/index.ts</parameter>\n"));
    translator.push(makeChunk("</function>\n"));
    translator.push(makeChunk("</tool_call>"));

    const output = translator.finish();
    const events = parseEvents(output);

    // Should have tool_use content_block_start
    const toolStart = events.find(
      (e) => e.event === "content_block_start" && e.data.content_block?.type === "tool_use"
    );
    assert.ok(toolStart, "should have tool_use content_block_start");
    assert.strictEqual(toolStart.data.content_block.name, "Read");

    // Should have input_json_delta
    const jsonDelta = events.find(
      (e) => e.event === "content_block_delta" && e.data.delta?.type === "input_json_delta"
    );
    assert.ok(jsonDelta, "should have input_json_delta");
    const input = JSON.parse(jsonDelta.data.delta.partial_json);
    assert.strictEqual(input.file_path, "src/index.ts");

    // stop_reason should be tool_use
    const msgDelta = events.find((e) => e.event === "message_delta");
    assert.ok(msgDelta);
    assert.strictEqual(msgDelta.data.delta.stop_reason, "tool_use");
  });

  it("strips <|im_end|> tokens from streamed deltas", () => {
    const translator = createStreamTranslator(model);
    translator.push(makeChunk("Hello"));
    const output = translator.push(makeChunk(" world.<|im_end|>"));
    const events = parseEvents(output);
    const delta = events.find((e) => e.event === "content_block_delta");
    assert.ok(delta);
    assert.strictEqual(delta.data.delta.text, " world.");
    assert.ok(!delta.data.delta.text.includes("<|im_end|>"), "should not contain im_end token");
  });

  it("handles chunk that is only <|im_end|>", () => {
    const translator = createStreamTranslator(model);
    translator.push(makeChunk("Hello"));
    const output = translator.push(makeChunk("<|im_end|>"));
    // Should just get the header ensure, no delta with im_end
    const events = parseEvents(output);
    const delta = events.find((e) => e.event === "content_block_delta");
    assert.ok(!delta, "should not emit a delta for a pure im_end chunk");
  });

  it("handles empty stream gracefully", () => {
    const translator = createStreamTranslator(model);
    const output = translator.finish();
    const events = parseEvents(output);
    const msgStart = events.find((e) => e.event === "message_start");
    assert.ok(msgStart);
    const msgStop = events.find((e) => e.event === "message_stop");
    assert.ok(msgStop);
  });
});
