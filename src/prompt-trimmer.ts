/**
 * Trim Claude Code's system prompt based on the local model's size.
 *
 * Claude Code sends a ~2000-3000 token system prompt designed for Claude
 * (Opus/Sonnet). Most of it is useless or harmful for small local models —
 * it burns prefill time and confuses the model with irrelevant instructions.
 *
 * Strategy:
 *  - small  (≤8B):  Replace with minimal prompt, keep env + user instructions
 *  - medium (9-32B): Moderate prompt, keep env + user instructions
 *  - large  (>32B):  Keep full prompt
 */

import type { AnthropicMessage, AnthropicContentBlock, AnthropicTextBlock } from "./translate-request.js";

export type ModelTier = "small" | "medium" | "large";

/**
 * Extract the parameter count (in billions) from a model ID.
 * Returns null if no size indicator is found.
 *
 * Examples:
 *   "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit" → 7
 *   "mlx-community/Qwen3-Coder-Next-4bit"           → null
 */
export function parseModelSize(modelId: string): number | null {
  const match = modelId.match(/(\d+)[Bb](?:-|$)/);
  return match ? parseInt(match[1], 10) : null;
}

export function getModelTier(modelId: string): ModelTier {
  const size = parseModelSize(modelId);
  if (size === null) return "large";
  if (size <= 8) return "small";
  if (size <= 32) return "medium";
  return "large";
}

// ── Extraction helpers ──────────────────────────────────────────────

/**
 * Extract environment context (working directory, branch, platform).
 */
function extractEnvironment(prompt: string): string {
  const lines: string[] = [];

  const wdMatch = prompt.match(/Primary working directory:\s*(.+)/);
  if (wdMatch) lines.push(`Working directory: ${wdMatch[1].trim()}`);

  const branchMatch = prompt.match(/Current branch:\s*(.+)/);
  if (branchMatch) lines.push(`Git branch: ${branchMatch[1].trim()}`);

  const platformMatch = prompt.match(/Platform:\s*(.+)/);
  if (platformMatch) lines.push(`Platform: ${platformMatch[1].trim()}`);

  return lines.length > 0 ? lines.join("\n") : "";
}

/**
 * Extract user-specific instructions (CLAUDE.md / MEMORY.md content).
 * Looks for "Contents of ...:" blocks and grabs their content.
 */
function extractUserInstructions(prompt: string): string {
  // Match "Contents of /path/to/file:" followed by content until the next
  // top-level section, gitStatus block, or end of string.
  const match = prompt.match(
    /Contents of [^\n]+:\s*\n([\s\S]*?)(?=\n(?:gitStatus:|IMPORTANT:|<system-reminder>)|$)/,
  );
  return match ? match[1].trim() : "";
}

// ── Tier-specific system prompts ────────────────────────────────────

const SMALL_SYSTEM = `You are a coding assistant. Help the user with software engineering tasks concisely and accurately.

Rules:
- Use the provided tools to interact with the filesystem
- Never guess or hallucinate file contents
- Read files before editing them
- Keep responses short and focused`;

const MEDIUM_SYSTEM = `You are a coding assistant that helps users with software engineering tasks.

Rules:
- Use the provided tools to interact with the filesystem. Never guess file contents.
- Read files before editing them.
- Keep responses concise and focused on the task.
- When editing files, prefer targeted edits over full rewrites.
- Do not create files unless necessary.
- Write secure code — avoid injection vulnerabilities.
- Only commit changes when explicitly asked.`;

// ── Main entry point ────────────────────────────────────────────────

export function trimSystemPrompt(systemPrompt: string, modelId: string): string {
  const tier = getModelTier(modelId);

  if (tier === "large") {
    return systemPrompt;
  }

  const env = extractEnvironment(systemPrompt);
  const userInstructions = extractUserInstructions(systemPrompt);
  const basePrompt = tier === "small" ? SMALL_SYSTEM : MEDIUM_SYSTEM;

  const sections = [basePrompt];
  if (env) sections.push(`## Environment\n${env}`);
  if (userInstructions) sections.push(`## Project Instructions\n${userInstructions}`);

  return sections.join("\n\n");
}

// ── Message trimming ─────────────────────────────────────────────────

/**
 * Test whether a text block is a <system-reminder> wrapper.
 */
function isSystemReminder(text: string): boolean {
  return /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/.test(text);
}

/**
 * Strip <system-reminder> wrappers from a text block, returning the inner content.
 */
function stripSystemReminderTags(text: string): string {
  return text.replace(/<\/?system-reminder>/g, "").trim();
}

/**
 * Test whether text is purely Claude Code infrastructure with no user value.
 * These are blocks that should be dropped entirely (not just unwrapped).
 */
function isDroppableBlock(text: string): boolean {
  const inner = stripSystemReminderTags(text);

  // Session start hook confirmations
  if (/^SessionStart[:.]/.test(inner)) return true;

  // Superpowers / skill system meta-instructions
  if (inner.includes("EXTREMELY_IMPORTANT") && inner.includes("superpowers")) return true;
  if (inner.includes("You have superpowers")) return true;

  // Skills listing
  if (/^The following skills are available/.test(inner)) return true;

  // Task tool reminders
  if (/^The task tools haven't been used recently/.test(inner)) return true;

  // Malware analysis reminders
  if (/^Whenever you read a file.*malware/.test(inner)) return true;

  return false;
}

/**
 * Test whether a text block is a duplicate of content already in the system prompt.
 * Matches the "claudeMd" / MEMORY.md block that Claude Code sends in both
 * the system field and as a user message content block.
 */
function isDuplicateClaudeMd(text: string): boolean {
  const inner = stripSystemReminderTags(text);
  return inner.includes("# claudeMd") || inner.includes("Contents of ") && inner.includes("MEMORY.md");
}

/**
 * Trim user message content blocks, removing Claude Code infrastructure
 * that wastes context on local models.
 *
 * Applied to all tiers — even large models benefit from not processing
 * 8K+ chars of skills/superpowers infrastructure they can't use.
 */
export function trimMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
  return messages.map((msg) => {
    // Only trim user messages — assistant messages are model history
    if (msg.role !== "user") return msg;

    // String content: strip system-reminder tags inline
    if (typeof msg.content === "string") {
      if (isSystemReminder(msg.content) && isDroppableBlock(msg.content)) {
        return { role: msg.role, content: "" };
      }
      return msg;
    }

    // Array content: filter out droppable text blocks
    const filtered: AnthropicContentBlock[] = [];
    for (const block of msg.content) {
      if (block.type !== "text") {
        filtered.push(block);
        continue;
      }

      // Drop entire block if it's infrastructure noise
      if (isSystemReminder(block.text) && isDroppableBlock(block.text)) {
        continue;
      }

      // Drop duplicate CLAUDE.md / MEMORY.md (already in system prompt)
      if (isSystemReminder(block.text) && isDuplicateClaudeMd(block.text)) {
        continue;
      }

      // For remaining system-reminder blocks, unwrap the tags
      // (keeps content like tool results that happen to be wrapped)
      if (isSystemReminder(block.text)) {
        const unwrapped = stripSystemReminderTags(block.text);
        if (unwrapped) {
          filtered.push({ type: "text", text: unwrapped } as AnthropicTextBlock);
        }
        continue;
      }

      filtered.push(block);
    }

    // If all blocks were filtered, keep a single empty text block
    // so the message structure remains valid
    if (filtered.length === 0) {
      return { role: msg.role, content: "" };
    }

    return { role: msg.role, content: filtered };
  });
}
