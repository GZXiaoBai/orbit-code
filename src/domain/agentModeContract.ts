import type { AgentRuntimeMode, ToolName } from "./agentLoop";

export interface ModeToolPolicy {
  mode: AgentRuntimeMode;
  allowedTools: ToolName[];
  deniedTools: ToolName[];
  switchTools: string[];
}

const allTools: ToolName[] = [
  "read_file",
  "search_code",
  "list_files",
  "run_command",
  "apply_patch",
  "propose_patch",
  "ask_user",
  "done",
  "done_plan",
  "done_build",
];

export const modeToolPolicies: Record<AgentRuntimeMode, ModeToolPolicy> = {
  plan: {
    mode: "plan",
    allowedTools: ["read_file", "list_files", "search_code", "ask_user", "done_plan"],
    deniedTools: ["run_command", "apply_patch", "propose_patch", "done_build"],
    switchTools: ["switch_to_build"],
  },
  build: {
    mode: "build",
    allowedTools: ["read_file", "list_files", "search_code", "ask_user", "run_command", "propose_patch", "done_build"],
    deniedTools: ["done_plan"],
    switchTools: ["switch_to_plan"],
  },
};

export function publicToolNamesForMode(mode: AgentRuntimeMode): ToolName[] {
  return modeToolPolicies[mode].allowedTools;
}

export function isToolAllowedInMode(mode: AgentRuntimeMode, tool: ToolName): boolean {
  if (mode === "build" && (tool === "apply_patch" || tool === "done")) return true;
  if (mode === "plan" && tool === "done") return true;
  return modeToolPolicies[mode].allowedTools.includes(tool);
}

export function deniedToolsForMode(mode: AgentRuntimeMode): ToolName[] {
  return allTools.filter((tool) => !isToolAllowedInMode(mode, tool));
}

export function normalizeRuntimeToolName(tool: ToolName): ToolName {
  if (tool === "apply_patch") return "propose_patch";
  if (tool === "done") return "done_build";
  return tool;
}
