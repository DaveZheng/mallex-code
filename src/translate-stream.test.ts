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

function collectAllOutput(translator: ReturnType<typeof createStreamTranslator>, chunks: string[]): string {
  let output = "";
  for (const c of chunks) {
    output += translator.push(makeChunk(c));
  }
  output += translator.finish();
  return output;
}

function collectTextDeltas(events: Array<{ event: string; data: any }>): string {
  return events
    .filter((e) => e.event === "content_block_delta" && e.data.delta?.type === "text_delta")
    .map((e) => e.data.delta.text)
    .join("");
}

describe("createStreamTranslator", () => {
  const model = "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit";

  it("emits message_start on first chunk", () => {
    const translator = createStreamTranslator(model);
    const output = translator.push(makeChunk("Hello world, this is a test."));
    const events = parseEvents(output);
    assert.strictEqual(events[0].event, "message_start");
    assert.strictEqual(events[0].data.message.role, "assistant");
    assert.strictEqual(events[0].data.message.model, model);
  });

  it("streams text deltas for plain text and flushes on finish", () => {
    const translator = createStreamTranslator(model);
    const output = collectAllOutput(translator, [
      "Hello world, this is a longer test response.",
      " And some more text here.",
    ]);
    const events = parseEvents(output);
    const text = collectTextDeltas(events);
    assert.ok(text.includes("Hello world"), "should include streamed text");
    assert.ok(text.includes("more text"), "should include all text");
  });

  it("emits message_stop on finish with no tool calls", () => {
    const translator = createStreamTranslator(model);
    const output = collectAllOutput(translator, ["Hello world, this is a test."]);
    const events = parseEvents(output);
    const stop = events.find((e) => e.event === "content_block_stop");
    assert.ok(stop, "should have content_block_stop");
    const msgDelta = events.find((e) => e.event === "message_delta");
    assert.ok(msgDelta);
    assert.strictEqual(msgDelta.data.delta.stop_reason, "end_turn");
    const msgStop = events.find((e) => e.event === "message_stop");
    assert.ok(msgStop);
  });

  it("suppresses tool call XML from text deltas", () => {
    const translator = createStreamTranslator(model);
    const output = collectAllOutput(translator, [
      "Let me read that file for you.\n\n",
      "<tool_call>\n",
      "<function=read_file>\n",
      "<parameter=file_path>src/index.ts</parameter>\n",
      "</function>\n",
      "</tool_call>",
    ]);
    const events = parseEvents(output);
    const text = collectTextDeltas(events);

    assert.ok(text.includes("Let me read that"), "should include pre-tool text");
    assert.ok(!text.includes("<tool_call>"), "should not include tool_call XML");
    assert.ok(!text.includes("<function="), "should not include function XML");
    assert.ok(!text.includes("<parameter="), "should not include parameter XML");
  });

  it("emits tool_use blocks when tool calls are found", () => {
    const translator = createStreamTranslator(model);
    const output = collectAllOutput(translator, [
      "Let me read that.\n\n",
      "<tool_call>\n",
      "<function=read_file>\n",
      "<parameter=file_path>src/index.ts</parameter>\n",
      "</function>\n",
      "</tool_call>",
    ]);
    const events = parseEvents(output);

    const toolStart = events.find(
      (e) => e.event === "content_block_start" && e.data.content_block?.type === "tool_use"
    );
    assert.ok(toolStart, "should have tool_use content_block_start");
    assert.strictEqual(toolStart.data.content_block.name, "Read");

    const jsonDelta = events.find(
      (e) => e.event === "content_block_delta" && e.data.delta?.type === "input_json_delta"
    );
    assert.ok(jsonDelta, "should have input_json_delta");
    const input = JSON.parse(jsonDelta.data.delta.partial_json);
    assert.strictEqual(input.file_path, "src/index.ts");

    const msgDelta = events.find((e) => e.event === "message_delta");
    assert.ok(msgDelta);
    assert.strictEqual(msgDelta.data.delta.stop_reason, "tool_use");
  });

  it("handles bare function tags without tool_call wrapper", () => {
    const translator = createStreamTranslator(model);
    const output = collectAllOutput(translator, [
      "Checking.\n\n",
      "<function=bash>\n",
      "<parameter=command>ls</parameter>\n",
      "</function>",
    ]);
    const events = parseEvents(output);
    const text = collectTextDeltas(events);

    assert.ok(!text.includes("<function="), "should not expose function XML");

    const toolStart = events.find(
      (e) => e.event === "content_block_start" && e.data.content_block?.type === "tool_use"
    );
    assert.ok(toolStart, "should parse bare function as tool_use");
    assert.strictEqual(toolStart.data.content_block.name, "Bash");
  });

  it("strips <|im_end|> tokens from streamed deltas", () => {
    const translator = createStreamTranslator(model);
    const output = collectAllOutput(translator, [
      "Hello world, this is a test.",
      " Final text.<|im_end|>",
    ]);
    const events = parseEvents(output);
    const text = collectTextDeltas(events);
    assert.ok(text.includes("Final text."), "should include text");
    assert.ok(!text.includes("<|im_end|>"), "should not contain im_end token");
  });

  it("handles chunk that is only <|im_end|>", () => {
    const translator = createStreamTranslator(model);
    translator.push(makeChunk("Hello world, this is a test."));
    const output = translator.push(makeChunk("<|im_end|>"));
    const events = parseEvents(output);
    const delta = events.find((e) => e.event === "content_block_delta" && e.data.delta?.type === "text_delta");
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

  it("flushes remaining text on finish when no tool call", () => {
    const translator = createStreamTranslator(model);
    // Short text that's within the safety buffer
    const output = collectAllOutput(translator, ["Short."]);
    const events = parseEvents(output);
    const text = collectTextDeltas(events);
    assert.ok(text.includes("Short."), "should flush buffered text on finish");
  });

  it("tool-only response with no preceding text", () => {
    const translator = createStreamTranslator(model);
    const output = collectAllOutput(translator, [
      "<tool_call>\n",
      "<function=bash>\n",
      "<parameter=command>echo hi</parameter>\n",
      "</function>\n",
      "</tool_call>",
    ]);
    const events = parseEvents(output);
    const text = collectTextDeltas(events);
    assert.strictEqual(text, "", "should have no text for tool-only response");

    const toolStart = events.find(
      (e) => e.event === "content_block_start" && e.data.content_block?.type === "tool_use"
    );
    assert.ok(toolStart);
    assert.strictEqual(toolStart.data.content_block.name, "Bash");
  });
});
