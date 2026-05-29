import type { AgentRuntimeMode, ToolName, ToolDefinition, ToolParams } from "../domain/agentLoop";
import { publicToolNamesForMode } from "../domain/agentModeContract";
import { parseCommandLine } from "./commandParser";
import { defaultWorkspaceGateway } from "./workspaceGateway";

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
  try {
    return await defaultWorkspaceGateway.readFile(path, context);
  } catch (e: any) {
    return `Error reading file: ${e?.message || String(e)}`;
  }
}

async function listFilesImpl(params: ToolParams, context: ToolExecutionContext): Promise<string> {
  const filter = asString(params.filter);
  try {
    const files = await defaultWorkspaceGateway.listFiles(context);
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
  try {
    const results = await defaultWorkspaceGateway.searchCode(pattern, context);
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
    description: "Execute a command in the workspace. Use for building, testing, linting. Prefer args over shell strings. Use cwd for a workspace subdirectory.",
    parameters: {
      command: { type: "string", description: "Executable or shell command to run", required: true },
      args: { type: "string[]", description: "Arguments passed to the executable", required: false },
      reason: { type: "string", description: "Why this command is needed", required: true },
      cwd: { type: "string", description: "Optional workspace-relative directory to run in, for example orbit-mini-lab", required: false },
    },
    requiresApproval: true,
  },
  apply_patch: {
    name: "apply_patch",
    description: "Legacy alias for propose_patch. Do not expose this in new prompts.",
    parameters: {
      patches: { type: "array", description: "Array of { path, oldContent, newContent } patch objects", required: true },
    },
    requiresApproval: true,
  },
  propose_patch: {
    name: "propose_patch",
    description: "Propose file content changes for user review. This does not write files until approved in Orbit's central patch overlay.",
    parameters: {
      patches: { type: "array", description: "Array of { path, oldContent, newContent } patch objects", required: true },
    },
    requiresApproval: true,
  },
  ask_user: {
    name: "ask_user",
    description: "Ask the user a blocking question when you need clarification or a product decision.",
    parameters: {
      question: { type: "string", description: "Question to ask the user", required: true },
      options: { type: "array", description: "Optional choices as { label, description, recommended }. Use this when the user should pick a path.", required: false },
      allowFreeform: { type: "boolean", description: "Whether the user may answer with custom text instead of choosing an option", required: false },
    },
    requiresApproval: false,
  },
  done: {
    name: "done",
    description: "Legacy alias for done_build. Do not expose this in new prompts.",
    parameters: {
      summary: { type: "string", description: "Summary of what was accomplished", required: true },
    },
    requiresApproval: false,
  },
  done_plan: {
    name: "done_plan",
    description: "Finish a read-only planning turn with the plan, assumptions, questions, and recommended next step.",
    parameters: {
      summary: { type: "string", description: "Planning summary and recommended path", required: true },
    },
    requiresApproval: false,
  },
  done_build: {
    name: "done_build",
    description: "Signal that the Build task is complete. Must include a summary of what was accomplished.",
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
  const cwd = asString(params.cwd);
  if (!command) return "Error: command is required";
  if (command === "cd" || /[;&|`$<>]/.test(command)) {
    return "Error: run_command must use a single executable and args. Do not use shell operators or cd; pass cwd for workspace subdirectories.";
  }
  if (args.length === 0 && /\s/.test(command)) {
    const parsed = parseCommandLine(command);
    if (parsed) {
      command = parsed.command;
      args = parsed.args;
    }
  }
  if (command === "cd") {
    return "Error: run_command cannot execute cd. Use {\"cwd\":\"relative/subdir\"} with the real command instead.";
  }
  try {
    return await defaultWorkspaceGateway.runCommand({
      command,
      args,
      sandboxMode: context.sandboxMode || "none",
      cwd,
    }, context);
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
    case "propose_patch":
    case "apply_patch": {
      return "Patch proposal captured for user review. No files were written.";
    }
    case "ask_user": return `[User question]: ${asString(params.question)}`;
    case "done_plan": return `Plan completed: ${asString(params.summary) || "Done"}`;
    case "done_build":
    case "done": return `Task completed: ${asString(params.summary) || "Done"}`;
    default: return `Unknown tool: ${name}`;
  }
}

export function buildToolRegistry(mode: AgentRuntimeMode): Partial<Record<ToolName, Omit<ToolDefinition, "execute">>> {
  const allowed = new Set(publicToolNamesForMode(mode));
  return Object.fromEntries(
    Object.entries(toolDefinitions).filter(([name]) => allowed.has(name as ToolName)),
  ) as Partial<Record<ToolName, Omit<ToolDefinition, "execute">>>;
}

export function buildToolsPrompt(mode: AgentRuntimeMode = "build"): string {
  const registry = buildToolRegistry(mode);
  const doneTool = mode === "plan" ? "done_plan" : "done_build";
  const tools = Object.entries(registry).map(([name, def]) => {
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
${mode === "plan" ? [
  "- Use read_file, list_files, and search_code to understand the project before drafting a plan.",
  "- Keep the result architectural: questions, options, risks, task draft, and acceptance criteria.",
].join("\n") : [
  "- ALWAYS use read_file before modifying a file to see its current content.",
  "- Use search_code to find relevant code before making changes.",
].join("\n")}
${mode === "plan" ? [
  "- You are in Plan mode. You may read, list, search, ask the user, and return done_plan only.",
  "- Do not run commands, propose patches, write files, or ask for command/patch approval.",
  "- When the planning turn is complete, output {\"tool\":\"done_plan\",\"params\":{\"summary\":\"...\"}}.",
].join("\n") : [
  "- For run_command, prefer {\"command\":\"npm\",\"args\":[\"test\",\"--\",\"--run\"],\"reason\":\"verify changes\"} instead of one shell string.",
  "- If a command must run inside a project subdirectory, pass cwd, e.g. {\"tool\":\"run_command\",\"params\":{\"command\":\"npm\",\"args\":[\"install\"],\"cwd\":\"orbit-mini-lab\",\"reason\":\"install dependencies inside the generated app\"}}. Never use \"cd ... && ...\".",
  "- For propose_patch, pass {\"patches\":[{\"path\":\"relative/file\",\"oldContent\":\"...\",\"newContent\":\"...\"}]}. It creates a review item; the user writes it after reviewing the diff. After propose_patch, stop and wait for review; do not call done_build yet.",
  "- After the user applies changes and starts verification, use run_command to run tests.",
].join("\n")}
- If you need user input, use ask_user. Prefer structured options, e.g. {"tool":"ask_user","params":{"question":"Which path should I take?","options":[{"label":"Safe path","description":"Run verification first.","recommended":true}],"allowFreeform":true}}.
- When you're done in ${mode === "plan" ? "Plan" : "Build"} mode, output {"tool": "${doneTool}", "params": {"summary": "what you did"}}`;
}

export function buildToolResultPrompt(
  results: Array<{ id: string; name: ToolName; result: string }>,
  mode: AgentRuntimeMode = "build",
): string {
  const doneTool = mode === "plan" ? "done_plan" : "done_build";
  return results.map(r =>
    `[Tool ${r.name} result]:\n${r.result}`
  ).join("\n\n") + `\n\nContinue based on these results. Call more tools if needed, or call '${doneTool}' if finished.`;
}
