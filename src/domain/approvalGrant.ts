import type { ToolParams } from "./agentLoop";
import type { AgentRuntimeMode } from "./agentLoop";
import type { PermissionAction } from "./types";

export type ApprovalGrantScope = "once" | "session" | "project";

export interface PolicyGrant {
  id: string;
  tool: string;
  key: string;
  workspacePath?: string;
  threadId?: string;
  mode?: AgentRuntimeMode;
  actions?: PermissionAction[];
  cwdOrPathScope?: string;
  scope: Exclude<ApprovalGrantScope, "once">;
  createdAt: string;
  expiresAt?: string;
}

export type ApprovalGrant = PolicyGrant;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["workspacePath", "threadId", "taskId", "sourceEventId"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function approvalGrantKey(tool: string, params: ToolParams): string {
  if (tool === "run_command") {
    const command = typeof params.command === "string" ? params.command : "";
    const args = Array.isArray(params.args) ? params.args.filter((arg): arg is string => typeof arg === "string") : [];
    const cwd = typeof params.cwd === "string" ? params.cwd : "";
    return `${tool}:${command}\u0000${args.join("\u0000")}\u0000${cwd}`;
  }
  return `${tool}:${stableStringify(params)}`;
}

export function recoverApprovalGrants(recovered: ApprovalGrant[] = []): ApprovalGrant[] {
  return recovered.filter((grant) =>
    (grant.scope === "session" && Boolean(grant.workspacePath && grant.threadId))
    || (grant.scope === "project" && Boolean(grant.workspacePath))
  );
}

export function persistableApprovalGrants(grants: ApprovalGrant[]): ApprovalGrant[] {
  return grants.filter((grant) => grant.scope === "session" || grant.scope === "project");
}

export function policyGrantMatches(input: {
  grant: PolicyGrant;
  mode: AgentRuntimeMode;
  tool: string;
  key: string;
  actions: PermissionAction[];
  workspacePath?: string;
  threadId?: string;
  now?: string;
}): boolean {
  const { grant, mode, tool, key, actions, workspacePath, threadId } = input;
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(input.now || new Date().toISOString())) {
    return false;
  }
  if (grant.tool !== tool || grant.key !== key) return false;
  const grantMode = grant.mode || "build";
  if (grantMode !== mode) return false;
  if (grant.workspacePath && workspacePath && grant.workspacePath !== workspacePath) return false;
  if (grant.workspacePath && !workspacePath) return false;
  if (grant.scope === "session") {
    if (!grant.threadId || !threadId || grant.threadId !== threadId) return false;
  }
  if (grant.actions?.length) {
    return actions.every((action) => grant.actions?.includes(action));
  }
  return true;
}
