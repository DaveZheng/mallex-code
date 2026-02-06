export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read file contents with line numbers",
    parameters: {
      file_path: { type: "string", description: "Absolute path to the file", required: true },
      offset: { type: "number", description: "Line number to start from (1-based)" },
      limit: { type: "number", description: "Max lines to read" },
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file",
    parameters: {
      file_path: { type: "string", description: "Absolute path to the file", required: true },
      content: { type: "string", description: "Content to write", required: true },
    },
  },
  {
    name: "edit_file",
    description: "Replace a string in a file. old_string must be unique in the file.",
    parameters: {
      file_path: { type: "string", description: "Absolute path to the file", required: true },
      old_string: { type: "string", description: "Text to find", required: true },
      new_string: { type: "string", description: "Replacement text", required: true },
    },
  },
  {
    name: "bash",
    description: "Execute a shell command and return output",
    parameters: {
      command: { type: "string", description: "The command to execute", required: true },
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern",
    parameters: {
      pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)", required: true },
      path: { type: "string", description: "Directory to search in" },
    },
  },
  {
    name: "grep",
    description: "Search file contents with a regex pattern",
    parameters: {
      pattern: { type: "string", description: "Regex pattern to search for", required: true },
      path: { type: "string", description: "File or directory to search in" },
    },
  },
];
