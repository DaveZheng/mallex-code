import { TOOL_DEFINITIONS, type ToolDefinition } from "./tool-definitions.js";

/**
 * Format a single tool definition as XML for injection into the system prompt.
 */
function formatToolXml(tool: ToolDefinition): string {
  const params = Object.entries(tool.parameters)
    .map(([name, p]) => `  <parameter name="${name}" type="${p.type}" required="${!!p.required}">${p.description}</parameter>`)
    .join("\n");
  return `<tool name="${tool.name}">\n  <description>${tool.description}</description>\n${params}\n</tool>`;
}

/**
 * Build the XML tool definitions block that gets injected into the system prompt.
 * This teaches the model the tool_call format and lists available tools.
 */
export function buildToolInjection(): string {
  const toolsXml = TOOL_DEFINITIONS.map(formatToolXml).join("\n\n");

  return [
    "",
    "## Tools",
    "",
    "You have access to the following tools. To use a tool, output a tool_call block in this exact format:",
    "",
    "<tool_call>",
    "<function=tool_name>",
    "<parameter=param_name>value</parameter>",
    "</function>",
    "</tool_call>",
    "",
    "CRITICAL RULES:",
    "- You MUST use tools to interact with the filesystem. NEVER guess or hallucinate file contents.",
    "- Always include the opening <tool_call> tag. Never omit it.",
    "- You may include text before a tool call to explain what you're doing.",
    "- You may make multiple tool calls in one response.",
    "- After a tool call, wait for the result before continuing.",
    "",
    "<tools>",
    toolsXml,
    "</tools>",
  ].join("\n");
}

/**
 * Inject tool definitions into a system prompt from Claude Code.
 * Appends the tool_call format instructions and tool definitions in XML.
 */
export function injectToolDefinitions(systemPrompt: string): string {
  return systemPrompt + "\n" + buildToolInjection();
}
