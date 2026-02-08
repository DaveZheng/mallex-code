import { describe, it } from "node:test";
import assert from "node:assert";
import { ClaudeApiError } from "./claude-client.js";

describe("ClaudeApiError", () => {
  it("preserves message and status", () => {
    const err = new ClaudeApiError("something went wrong", 500);
    assert.strictEqual(err.message, "something went wrong");
    assert.strictEqual(err.status, 500);
    assert.strictEqual(err.name, "ClaudeApiError");
  });

  it("classifies 401 as auth error", () => {
    const err = new ClaudeApiError("unauthorized", 401);
    assert.strictEqual(err.isAuthError, true);
    assert.strictEqual(err.isRateLimited, false);
    assert.strictEqual(err.isOverloaded, false);
  });

  it("classifies 429 as rate limited", () => {
    const err = new ClaudeApiError("rate limited", 429);
    assert.strictEqual(err.isAuthError, false);
    assert.strictEqual(err.isRateLimited, true);
    assert.strictEqual(err.isOverloaded, false);
  });

  it("classifies 529 as overloaded", () => {
    const err = new ClaudeApiError("overloaded", 529);
    assert.strictEqual(err.isAuthError, false);
    assert.strictEqual(err.isRateLimited, false);
    assert.strictEqual(err.isOverloaded, true);
  });

  it("classifies 500 as none of the special categories", () => {
    const err = new ClaudeApiError("internal server error", 500);
    assert.strictEqual(err.isAuthError, false);
    assert.strictEqual(err.isRateLimited, false);
    assert.strictEqual(err.isOverloaded, false);
  });
});
