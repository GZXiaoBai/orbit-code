import type { PolicyDecision } from "../runtime/policyEngine";
import type { ToolName, ToolParams } from "./agentLoop";

export type ToolCallLifecycleStatus =
  | "generated"
  | "policyEvaluated"
  | "actionRequired"
  | "running"
  | "completed"
  | "failed"
  | "denied"
  | "cancelled";

export interface ToolCallLifecycle {
  id: string;
  tool: ToolName | string;
  args?: ToolParams;
  argsSummary?: string;
  status: ToolCallLifecycleStatus;
  policyDecision?: PolicyDecision;
  actionRequiredId?: string;
  threadEventId?: string;
  terminalRunId?: string;
  resultText?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
}

export function createToolCallLifecycle(input: Omit<ToolCallLifecycle, "createdAt" | "status"> & {
  createdAt?: string;
  status?: ToolCallLifecycleStatus;
}): ToolCallLifecycle {
  return {
    ...input,
    status: input.status || "generated",
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function updateToolCallLifecycle(
  call: ToolCallLifecycle,
  update: Partial<ToolCallLifecycle>,
  at = new Date().toISOString(),
): ToolCallLifecycle {
  return {
    ...call,
    ...update,
    updatedAt: at,
  };
}

export function toolCallLifecycleToolResult(call: ToolCallLifecycle): string {
  if (call.status === "denied") return `Denied ${call.tool}: ${call.error || call.resultText || "blocked by policy"}`;
  if (call.status === "cancelled") return `Cancelled ${call.tool}.`;
  if (call.status === "failed") return `Failed ${call.tool}: ${call.error || call.resultText || "unknown error"}`;
  if (call.status === "completed") return call.resultText || `Completed ${call.tool}.`;
  return `${call.tool} is ${call.status}.`;
}
