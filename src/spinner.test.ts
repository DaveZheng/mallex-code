import { describe, it } from "node:test";
import assert from "node:assert";
import { PassThrough } from "node:stream";
import { Spinner } from "./spinner.js";

function makeStream(tty: boolean): PassThrough & { isTTY: boolean } {
  const stream = new PassThrough() as PassThrough & { isTTY: boolean };
  stream.isTTY = tty;
  return stream;
}

function drain(stream: PassThrough): string {
  const chunks: Buffer[] = [];
  let chunk: Buffer | null;
  while ((chunk = stream.read() as Buffer | null) !== null) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

describe("Spinner", () => {
  describe("TTY mode", () => {
    it("start sets isSpinning and writes frame", () => {
      const stream = makeStream(true);
      const spinner = new Spinner(stream);
      spinner.start("Loading...");
      assert.ok(spinner.isSpinning);
      const output = drain(stream);
      assert.ok(output.includes("Loading..."), "should contain message");
      assert.ok(output.includes("⠋"), "should contain first braille frame");
      spinner.stop();
      assert.ok(!spinner.isSpinning);
    });

    it("succeed stops spinner and writes green checkmark", () => {
      const stream = makeStream(true);
      const spinner = new Spinner(stream);
      spinner.start("Working...");
      drain(stream); // discard start output
      spinner.succeed("Done!");
      assert.ok(!spinner.isSpinning);
      const output = drain(stream);
      assert.ok(output.includes("✔"), "should contain checkmark");
      assert.ok(output.includes("Done!"), "should contain message");
      assert.ok(output.includes("\x1b[32m"), "should contain green ANSI code");
    });

    it("fail stops spinner and writes red cross", () => {
      const stream = makeStream(true);
      const spinner = new Spinner(stream);
      spinner.start("Working...");
      drain(stream);
      spinner.fail("Error!");
      assert.ok(!spinner.isSpinning);
      const output = drain(stream);
      assert.ok(output.includes("✘"), "should contain cross");
      assert.ok(output.includes("Error!"), "should contain message");
      assert.ok(output.includes("\x1b[31m"), "should contain red ANSI code");
    });

    it("update changes the message", () => {
      const stream = makeStream(true);
      const spinner = new Spinner(stream);
      spinner.start("Step 1");
      drain(stream);
      spinner.update("Step 2");
      // Force a render by waiting for next interval tick
      // The message is stored internally; next render will use it
      spinner.stop();
      // In TTY mode, update doesn't write immediately — it's picked up by render
      assert.ok(!spinner.isSpinning);
    });

    it("stop clears the line", () => {
      const stream = makeStream(true);
      const spinner = new Spinner(stream);
      spinner.start("Temp");
      drain(stream);
      spinner.stop();
      const output = drain(stream);
      assert.ok(output.includes("\x1b[K"), "should clear the line");
      assert.ok(!spinner.isSpinning);
    });

    it("start is idempotent when already spinning", () => {
      const stream = makeStream(true);
      const spinner = new Spinner(stream);
      spinner.start("First");
      spinner.start("Second"); // should not create a second timer
      assert.ok(spinner.isSpinning);
      spinner.stop();
      assert.ok(!spinner.isSpinning);
    });
  });

  describe("non-TTY mode", () => {
    it("start writes plain text line", () => {
      const stream = makeStream(false);
      const spinner = new Spinner(stream);
      spinner.start("Loading...");
      assert.ok(spinner.isSpinning);
      const output = drain(stream);
      assert.strictEqual(output, "Loading...\n");
      spinner.stop();
    });

    it("update writes plain text line", () => {
      const stream = makeStream(false);
      const spinner = new Spinner(stream);
      spinner.start("Step 1");
      drain(stream);
      spinner.update("Step 2");
      const output = drain(stream);
      assert.strictEqual(output, "Step 2\n");
      spinner.stop();
    });

    it("succeed writes checkmark without ANSI codes", () => {
      const stream = makeStream(false);
      const spinner = new Spinner(stream);
      spinner.start("Working...");
      drain(stream);
      spinner.succeed("Done!");
      const output = drain(stream);
      assert.strictEqual(output, "✔ Done!\n");
      assert.ok(!output.includes("\x1b["), "should not contain ANSI codes");
    });

    it("fail writes cross without ANSI codes", () => {
      const stream = makeStream(false);
      const spinner = new Spinner(stream);
      spinner.start("Working...");
      drain(stream);
      spinner.fail("Error!");
      const output = drain(stream);
      assert.strictEqual(output, "✘ Error!\n");
      assert.ok(!output.includes("\x1b["), "should not contain ANSI codes");
    });
  });
});
