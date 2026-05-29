import type { AgentEventPatch } from "../../domain/agentEvents";
import type { TaskStatus } from "../../domain/types";
import { commandPermissionActions } from "../../runtime/approvalPolicy";
import { formatCommandForDisplay } from "../../runtime/commandParser";

export function statusTone(status: TaskStatus) {
  if (status === "done" || status === "verified") return "success";
  if (status === "blocked") return "danger";
  if (status === "running" || status === "review") return "warning";
  return "neutral";
}

export function commandApprovalView(params: Record<string, unknown>, fallbackReason: string) {
  const command = typeof params.command === "string" ? params.command : "";
  const args = Array.isArray(params.args)
    ? params.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const reason = typeof params.reason === "string" && params.reason.trim()
    ? params.reason
    : fallbackReason;
  const display = command ? formatCommandForDisplay(command, args) : JSON.stringify(params, null, 2);
  return {
    display,
    reason,
    args,
    actions: commandPermissionActions(display),
    workspacePath: typeof params.workspacePath === "string" ? params.workspacePath : "",
    cwd: typeof params.cwd === "string" ? params.cwd : "",
  };
}

export function patchSandboxSummary(event: { patches?: AgentEventPatch[] }) {
  const patches = event.patches || [];
  if (patches.some((patch) => patch.sandboxStatus === "failed")) return "failed";
  if (patches.some((patch) => patch.sandboxStatus === "sandboxing")) return "sandboxing";
  if (patches.length > 0 && patches.every((patch) => patch.sandboxStatus === "sandboxed")) return "sandboxed";
  return "idle";
}

export function patchApplySummary(event: { patches?: AgentEventPatch[] }) {
  const patches = event.patches || [];
  if (patches.some((patch) => patch.applyStatus === "failed")) return "failed";
  if (patches.length > 0 && patches.every((patch) => patch.applied || patch.applyStatus === "applied")) return "applied";
  return "proposed";
}
