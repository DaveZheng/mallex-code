import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";

const execFileAsync = promisify(execFile);

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

export async function executeTool(name: string, input: Record<string, string>): Promise<string> {
  switch (name) {
    case "read_file":
      return readFile(input.file_path, parseInt(input.offset) || undefined, parseInt(input.limit) || undefined);
    case "write_file":
      return writeFile(input.file_path, input.content);
    case "edit_file":
      return editFile(input.file_path, input.old_string, input.new_string);
    case "bash":
      return bash(input.command);
    case "glob":
      return globFiles(input.pattern, input.path);
    case "grep":
      return grepFiles(input.pattern, input.path);
    default:
      return `Error: Unknown tool "${name}"`;
  }
}

function readFile(filePath: string, offset?: number, limit?: number): string {
  const content = fs.readFileSync(filePath, "utf-8");
  let lines = content.split("\n");
  if (offset) lines = lines.slice(offset - 1);
  if (limit) lines = lines.slice(0, limit);
  return lines.map((line, i) => `${(offset ?? 1) + i}\t${line}`).join("\n");
}

function writeFile(filePath: string, content: string): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return `File written: ${filePath}`;
}

function editFile(filePath: string, oldString: string, newString: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const count = content.split(oldString).length - 1;
  if (count === 0) return `Error: old_string not found in ${filePath}`;
  if (count > 1) return `Error: old_string found ${count} times in ${filePath} — must be unique`;
  fs.writeFileSync(filePath, content.replace(oldString, newString));
  return `File edited: ${filePath}`;
}

async function bash(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    return (stdout + stderr).trim();
  } catch (err: unknown) {
    const e = err as { code?: number; stderr?: string; message?: string };
    return `Error (exit ${e.code}): ${e.stderr || e.message}`;
  }
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports *, **, and ? wildcards.
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches any number of directories
        if (pattern[i + 2] === "/") {
          regexStr += "(?:.+/)?";
          i += 3;
        } else {
          regexStr += ".*";
          i += 2;
        }
      } else {
        // * matches anything except /
        regexStr += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else if (ch === ".") {
      regexStr += "\\.";
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  return new RegExp(`^${regexStr}$`);
}

async function globFiles(pattern: string, dir?: string): Promise<string> {
  const cwd = dir || process.cwd();
  const regex = globToRegex(pattern);

  // Determine if we need recursive search
  const needsRecursive = pattern.includes("/") || pattern.includes("**");

  const entries: string[] = await readdir(cwd, { recursive: needsRecursive } as { recursive?: boolean });
  const matches = entries
    .filter((entry) => regex.test(entry))
    .sort();

  return matches.join("\n") || "No files found.";
}

async function grepFiles(pattern: string, dir?: string): Promise<string> {
  const cwd = dir || process.cwd();
  try {
    const { stdout } = await execFileAsync("grep", ["-rn", pattern, cwd], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim() || "No matches found.";
  } catch {
    return "No matches found.";
  }
}
