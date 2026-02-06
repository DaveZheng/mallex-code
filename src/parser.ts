export interface ParsedToolCall {
  name: string;
  input: Record<string, string>;
}

export interface ParseResult {
  text: string;
  toolCalls: ParsedToolCall[];
}

export function parseToolCalls(output: string): ParseResult {
  const toolCalls: ParsedToolCall[] = [];

  // Strip special tokens that leak from tokenizer
  let cleaned = output.replace(/<\|im_end\|>/g, "").replace(/<\|im_start\|>/g, "");

  // Normalize: handle missing <tool_call> tag (known Qwen issue)
  // Use a two-pass approach:
  // 1. Mark existing <tool_call> openings with a sentinel
  // 2. Insert <tool_call> before bare <function= tags
  // 3. Remove sentinels
  const sentinel = "\0TOOL_CALL_PRESENT\0";
  let normalized = cleaned.replace(/<tool_call>\s*(<function=)/g, `${sentinel}$1`);
  normalized = normalized.replace(/<function=/g, "<tool_call>\n<function=");
  normalized = normalized.replace(new RegExp(sentinel.replace(/\0/g, "\\0"), "g"), "");

  // Normalize: handle missing </tool_call> closing tag
  // Insert </tool_call> after </function> if not already followed by one
  normalized = normalized.replace(/<\/function>\s*(?!<\/tool_call>)/g, "</function>\n</tool_call>");

  // Extract all tool call blocks
  const blockRegex = /<tool_call>\s*<function=([^>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  const textParts: string[] = [];

  // Collect text before first tool call
  const firstToolCall = normalized.search(/<tool_call>/);
  if (firstToolCall > 0) {
    textParts.push(normalized.slice(0, firstToolCall));
  } else if (firstToolCall === -1) {
    return { text: cleaned.trim(), toolCalls: [] };
  }

  while ((match = blockRegex.exec(normalized)) !== null) {
    const name = match[1].trim();
    const body = match[2];
    const input: Record<string, string> = {};

    const paramRegex = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      input[paramMatch[1].trim()] = paramMatch[2].trim();
    }

    toolCalls.push({ name, input });
  }

  const text = textParts.join("").trim();
  return { text, toolCalls };
}
