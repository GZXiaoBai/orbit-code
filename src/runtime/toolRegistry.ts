import { invoke } from "@tauri-apps/api/core";
import type { ToolName, ToolDefinition, ToolParams } from "../domain/agentLoop";
import { isTauri } from "../utils/tauri";
import { parseCommandLine } from "./commandParser";

interface ToolExecutionContext {
  workspacePath?: string;
  sandboxMode?: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function readFileImpl(params: ToolParams, context: ToolExecutionContext): Promise<string> {
  const path = asString(params.path);
  if (!path) return "Error: path is required";
  if (!isTauri()) return "Desktop runtime required for local file access.";
  try {
    return await invoke<string>("read_workspace_file", { path, workspacePath: context.workspacePath || "" });
  } catch (e: any) {
    return `Error reading file: ${e?.message || String(e)}`;
  }
}

async function listFilesImpl(params: ToolParams, context: ToolExecutionContext): Promise<string> {
  const filter = asString(params.filter);
  if (!isTauri()) return "Desktop runtime required for local file access.";
  try {
    const files = await invoke<string[]>("list_workspace_files", { workspacePath: context.workspacePath || "" });
    if (filter) {
      return files.filter((f) => f.includes(filter)).join("\n") || "No matching files found";
    }
    return files.join("\n");
  } catch (e: any) {
    return `Error listing files: ${e?.message || String(e)}`;
  }
}

async function searchCodeImpl(params: ToolParams, context: ToolExecutionContext): Promise<string> {
  const pattern = asString(params.pattern) || asString(params.query);
  if (!pattern) return "Error: pattern/query is required";
  if (!isTauri()) return "Desktop runtime required for local code search.";
  try {
    const files = await invoke<string[]>("list_workspace_files", { workspacePath: context.workspacePath || "" });
    const results: string[] = [];
    for (const file of files) {
      if (file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js") || file.endsWith(".jsx") ||
          file.endsWith(".css") || file.endsWith(".json") || file.endsWith(".md") || file.endsWith(".yaml") ||
          file.endsWith(".yml") || file.endsWith(".html")) {
        try {
          const content = await invoke<string>("read_workspace_file", { path: file, workspacePath: context.workspacePath || "" });
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
              results.push(`${file}:${i + 1}: ${lines[i].trim().substring(0, 120)}`);
              if (results.length >= 30) break;
            }
          }
        } catch { /* skip unreadable */ }
      }
      if (results.length >= 30) break;
    }
    return results.length > 0 ? results.join("\n") : `No matches found for "${pattern}"`;
  } catch (e: any) {
    return `Error searching: ${e?.message || String(e)}`;
  }
}

export const toolDefinitions: Record<ToolName, Omit<ToolDefinition, "execute">> = {
  read_file: {
    name: "read_file",
    description: "Read the full content of a file in the workspace. Use this to understand existing code.",
    parameters: {
      path: { type: "string", description: "Relative file path in the workspace", required: true },
    },
    requiresApproval: false,
  },
  list_files: {
    name: "list_files",
    description: "List all files in the workspace, optionally filtered by a pattern.",
    parameters: {
      filter: { type: "string", description: "Optional substring filter for file paths", required: false },
    },
    requiresApproval: false,
  },
  search_code: {
    name: "search_code",
    description: "Search for text/pattern in all source files. Returns file:line:preview matches (max 30).",
    parameters: {
      query: { type: "string", description: "Search query or pattern (case-insensitive)", required: true },
    },
    requiresApproval: false,
  },
  run_command: {
    name: "run_command",
    description: "Execute a command in the workspace. Use for building, testing, linting. Prefer args over shell strings.",
    parameters: {
      command: { type: "string", description: "Executable or shell command to run", required: true },
      args: { type: "string[]", description: "Arguments passed to the executable", required: false },
      reason: { type: "string", description: "Why this command is needed", required: true },
    },
    requiresApproval: true,
  },
  apply_patch: {
    name: "apply_patch",
    description: "Propose file content changes for user review. This does not write files until approved in the Review dock.",
    parameters: {
      patches: { type: "array", description: "Array of { path, oldContent, newContent } patch objects", required: true },
    },
    requiresApproval: true,
  },
  ask_user: {
    name: "ask_user",
    description: "Ask the user a question when you need clarification or approval.",
    parameters: {
      question: { type: "string", description: "Question to ask the user", required: true },
    },
    requiresApproval: false,
  },
  done: {
    name: "done",
    description: "Signal that the task is complete. Must include a summary of what was accomplished.",
    parameters: {
      summary: { type: "string", description: "Summary of what was accomplished", required: true },
    },
    requiresApproval: false,
  },
};

// Need a synchronous command execution for the agent loop
async function runCommandSyncFallback(params: ToolParams, context: ToolExecutionContext): Promise<string> {
  let command = asString(params.command);
  let args = asStringArray(params.args);
  if (!command) return "Error: command is required";
  if (args.length === 0 && /\s/.test(command)) {
    const parsed = parseCommandLine(command);
    if (parsed) {
      command = parsed.command;
      args = parsed.args;
    }
  }
  if (!isTauri()) return "Desktop runtime required for command execution.";
  try {
    return await invoke<string>("run_command_sync", {
      command,
      args,
      sandboxMode: context.sandboxMode || "none",
      workspacePath: context.workspacePath || "",
    });
  } catch (e: any) {
    return `Error running command: ${e?.message || String(e)}`;
  }
}

export async function executeToolCall(
  name: ToolName,
  params: ToolParams,
  context: ToolExecutionContext = {}
): Promise<string> {
  switch (name) {
    case "read_file": return readFileImpl(params, context);
    case "list_files": return listFilesImpl(params, context);
    case "search_code": return searchCodeImpl(params, context);
    case "run_command": return runCommandSyncFallback(params, context);
    case "apply_patch": {
      return "Patch proposal captured for user review. No files were written.";
    }
    case "ask_user": return `[User question]: ${asString(params.question)}`;
    case "done": return `Task completed: ${asString(params.summary) || "Done"}`;
    default: return `Unknown tool: ${name}`;
  }
}

export function buildToolsPrompt(): string {
  const tools = Object.entries(toolDefinitions).map(([name, def]) => {
    const params = Object.entries(def.parameters)
      .map(([k, v]) => `    - ${k} (${v.type}${v.required ? ", required" : ""}): ${v.description}`)
      .join("\n");
    return `- ${name}: ${def.description}\n  Parameters:\n${params}`;
  }).join("\n\n");

  return `## Available Tools

You have access to the following tools. To use a tool, output a tool call in this exact JSON format on a single line:

{"tool": "tool_name", "params": {"param1": "value1"}}

Available tools:
${tools}

Rules:
- ALWAYS use read_file before modifying a file to see its current content.
- Use search_code to find relevant code before making changes.
- For run_command, prefer {"command":"npm","args":["test","--","--run"],"reason":"verify changes"} instead of one shell string.
- For apply_patch, pass {"patches":[{"path":"relative/file","oldContent":"...","newContent":"..."}]}. It creates a review item; the user writes it after reviewing the diff. After apply_patch, stop and wait for review; do not call done yet.
- After the user applies changes and starts verification, use run_command to run tests.
- If you need user input, use ask_user.
- When you're done, output {"tool": "done", "params": {"summary": "what you did"}}`;
}

export function buildToolResultPrompt(results: Array<{ id: string; name: ToolName; result: string }>): string {
  return results.map(r =>
    `[Tool ${r.name} result]:\n${r.result}`
  ).join("\n\n") + "\n\nContinue based on these results. Call more tools if needed, or call 'done' if finished.";
}
