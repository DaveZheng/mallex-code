import { Writable } from "node:stream";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export class Spinner {
  private stream: Writable & { isTTY?: boolean };
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIdx = 0;
  private message = "";

  constructor(stream?: Writable & { isTTY?: boolean }) {
    this.stream = stream ?? process.stderr;
  }

  get isSpinning(): boolean {
    return this.timer !== null;
  }

  private get isTTY(): boolean {
    return this.stream.isTTY === true;
  }

  start(msg: string): void {
    this.message = msg;
    if (this.timer) return; // already spinning

    if (this.isTTY) {
      this.frameIdx = 0;
      this.render();
      this.timer = setInterval(() => this.render(), INTERVAL_MS);
    } else {
      this.stream.write(msg + "\n");
      // Set a marker so isSpinning returns true
      this.timer = setInterval(() => {}, 60_000);
    }
  }

  update(msg: string): void {
    this.message = msg;
    if (!this.isTTY && this.timer) {
      this.stream.write(msg + "\n");
    }
  }

  succeed(msg: string): void {
    this.clear();
    if (this.isTTY) {
      this.stream.write(`\x1b[32m✔\x1b[0m ${msg}\n`);
    } else {
      this.stream.write(`✔ ${msg}\n`);
    }
    this.stopTimer();
  }

  fail(msg: string): void {
    this.clear();
    if (this.isTTY) {
      this.stream.write(`\x1b[31m✘\x1b[0m ${msg}\n`);
    } else {
      this.stream.write(`✘ ${msg}\n`);
    }
    this.stopTimer();
  }

  stop(): void {
    this.clear();
    this.stopTimer();
  }

  private render(): void {
    const frame = FRAMES[this.frameIdx % FRAMES.length];
    this.frameIdx++;
    this.stream.write(`\r\x1b[K${frame} ${this.message}`);
  }

  private clear(): void {
    if (this.isTTY) {
      this.stream.write("\r\x1b[K");
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
