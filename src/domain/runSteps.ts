import type { ThreadEvent } from "./threadEvents";
import type { ActionRequiredEvent } from "./actionRequired";
import type { ToolCallLifecycle } from "./toolCallLifecycle";
import type { RuntimeLedgerSelectorSnapshot } from "./threadEventSelectors";

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

function statusFromActionRequired(status: ActionRequiredEvent["status"]): RunStepStatus {
  if (status === "approved" || status === "resolved") return "done";
  if (status === "denied") return "denied";
  if (status === "cancelled" || status === "expired") return "cancelled";
  return "waiting";
}

function statusFromThreadEvent(event: ThreadEvent): RunStepStatus {
  if (event.approval?.status === "denied") return "denied";
  if (event.approval?.status === "cancelled") return "cancelled";
  if (event.approval?.status === "pending") return "waiting";
  if (event.rollback?.status === "failed") return "failed";
  if (event.rollback?.status === "pending" || event.rollback?.status === "running") return "running";
  if (event.verification?.status === "failed") return "failed";
  if (event.verification?.status === "denied") return "denied";
  if (event.verification?.status === "pending" || event.verification?.status === "running") return "waiting";
  if (event.status === "thinking" || event.status === "active") return "running";
  if (event.status === "idle" && (event.kind === "approval" || event.kind === "question" || event.kind === "commandExecution")) return "waiting";
  return "done";
}

function kindFromThreadEvent(event: ThreadEvent): RunStepKind {
  if (event.kind === "approval" || event.kind === "approvalRequest" || event.kind === "approvalResult") {
    return event.approval?.tool === "run_command" || /command|命令/i.test(event.title) ? "command" : "approval";
  }
  if (event.kind === "commandBegin" || event.kind === "commandEnd" || event.kind === "commandExecution" || event.kind === "terminalRun") return "command";
  if (event.kind === "patchProposal" || event.patches?.length) return "patch";
  if (event.kind === "verification") return "terminal";
  return "agent";
}

function statusFromAgent(status: ThreadEvent["status"]): RunStepStatus {
  if (status === "thinking" || status === "active") return "running";
  return "done";
}

function createdAtFromEvent(event: ThreadEvent): string {
  if (event.createdAt) return event.createdAt;
  const idTime = event.id.match(/(\d{12,})/)?.[1];
  if (idTime) return new Date(Number(idTime)).toISOString();
  return event.timestamp;
}

export function runStepsFromActionRequired(actions: ActionRequiredEvent[]): RunStep[] {
  return actions.map((action) => ({
    id: `action:${action.id}`,
    kind: action.kind === "question" ? "approval" : action.kind === "patchReview" ? "patch" : action.kind === "verification" ? "terminal" : "approval",
    status: statusFromActionRequired(action.status),
    title: action.title,
    detail: action.question || action.description,
    approvalId: action.id,
    createdAt: action.createdAt,
  }));
}

export function runStepsFromToolLifecycle(toolCalls: ToolCallLifecycle[]): RunStep[] {
  return toolCalls.map((call) => ({
    id: `tool:${call.id}`,
    kind: call.tool === "run_command" ? "command" : "agent",
    status: call.status === "completed"
      ? "done"
      : call.status === "failed"
        ? "failed"
        : call.status === "denied"
          ? "denied"
          : call.status === "cancelled"
            ? "cancelled"
            : call.status === "running"
              ? "running"
              : "waiting",
    title: String(call.tool),
    detail: call.resultText || call.error || call.policyDecision?.reason || call.argsSummary || String(call.tool),
    approvalId: call.actionRequiredId,
    eventId: call.threadEventId,
    createdAt: call.createdAt,
  }));
}

export function runStepsFromEvents(events: ThreadEvent[]): RunStep[] {
  return events.map((event) => ({
    id: `event:${event.id}`,
    kind: kindFromThreadEvent(event),
    status: statusFromThreadEvent(event) || statusFromAgent(event.status),
    title: event.title,
    detail: event.message,
    eventId: event.id,
    createdAt: createdAtFromEvent(event),
  }));
}

export function selectRunSteps(input: RuntimeLedgerSelectorSnapshot): RunStep[] {
  return [
    ...runStepsFromEvents(input.threadEvents),
    ...runStepsFromActionRequired(input.actionRequired),
    ...runStepsFromToolLifecycle(input.toolCalls || []),
  ].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
    return aTime - bTime;
  });
}
