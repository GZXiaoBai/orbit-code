import type { AgentEvent } from "./agentEvents";

export type RunStepKind = "agent" | "approval" | "command" | "patch" | "terminal";
export type RunStepStatus = "waiting" | "running" | "done" | "failed" | "denied" | "cancelled";

export interface RunStep {
  id: string;
  kind: RunStepKind;
  status: RunStepStatus;
  title: string;
  detail: string;
  approvalId?: string;
  eventId?: string;
  createdAt: string;
}

interface ApprovalLike {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  createdAt: string;
}

function statusFromApproval(status: ApprovalLike["status"]): RunStepStatus {
  if (status === "approved") return "done";
  if (status === "denied") return "denied";
  if (status === "cancelled") return "cancelled";
  return "waiting";
}

function statusFromAgent(status: AgentEvent["status"]): RunStepStatus {
  if (status === "thinking" || status === "active") return "running";
  return "done";
}

function createdAtFromEvent(event: AgentEvent): string {
  if (event.createdAt) return event.createdAt;
  const idTime = event.id.match(/(\d{12,})/)?.[1];
  if (idTime) return new Date(Number(idTime)).toISOString();
  return event.timestamp;
}

export function runStepsFromApprovals(requests: ApprovalLike[]): RunStep[] {
  return requests.map((request) => ({
    id: `approval:${request.id}`,
    kind: request.tool === "run_command" ? "command" : "approval",
    status: statusFromApproval(request.status),
    title: request.tool,
    detail: request.reason || JSON.stringify(request.params),
    approvalId: request.id,
    createdAt: request.createdAt,
  }));
}

export function runStepsFromEvents(events: AgentEvent[]): RunStep[] {
  return events.map((event) => ({
    id: `event:${event.id}`,
    kind: event.patches?.length ? "patch" : "agent",
    status: statusFromAgent(event.status),
    title: event.name,
    detail: event.message,
    eventId: event.id,
    createdAt: createdAtFromEvent(event),
  }));
}

export function mergeRunSteps(events: AgentEvent[], approvals: ApprovalLike[]): RunStep[] {
  return [...runStepsFromEvents(events), ...runStepsFromApprovals(approvals)].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
    return aTime - bTime;
  });
}
