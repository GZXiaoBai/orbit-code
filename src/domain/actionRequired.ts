import type { ToolName, ToolParams } from "./agentLoop";
import type { QuestionOption } from "./questionRequest";

export type ActionRequiredKind =
  | "question"
  | "command"
  | "write"
  | "network"
  | "install"
  | "verification"
  | "patchReview";

export type ActionRequiredStatus =
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "expired"
  | "resolved";

export type ActionGrantScope = "once" | "session" | "project";

export interface ResumeAction {
  type: "approval" | "question" | "patchReview" | "verification";
  payloadId: string;
}

export interface ActionRequiredEvent {
  id: string;
  kind: ActionRequiredKind;
  tool?: ToolName | string;
  params?: ToolParams;
  question?: string;
  options?: QuestionOption[];
  allowFreeform?: boolean;
  workspacePath?: string;
  threadId?: string;
  taskId?: string;
  runSessionId?: string;
  toolCallId?: string;
  sourceEventId?: string;
  title: string;
  description: string;
  grantScope?: ActionGrantScope;
  status: ActionRequiredStatus;
  createdAt: string;
  resolvedAt?: string;
  expiresAt?: string;
  resumeAction?: ResumeAction;
  answer?: string;
  reason?: string;
  toolResultText?: string;
}

export interface ActionResolution {
  approved?: boolean;
  answer?: string | null;
  status?: Extract<ActionRequiredStatus, "approved" | "denied" | "cancelled" | "expired" | "resolved">;
  resolvedAt?: string;
  reason?: string;
  toolResultText?: string;
}

export interface ActionRequiredResolution {
  status: ActionRequiredStatus;
  toolResultText: string;
  resumeAction?: ResumeAction;
  resolvedAt?: string;
  answer?: string;
  hadLiveResolver?: boolean;
}

export function createActionRequiredEvent(
  input: Omit<ActionRequiredEvent, "id" | "status" | "createdAt"> & {
    id?: string;
    status?: ActionRequiredStatus;
    createdAt?: string;
  },
): ActionRequiredEvent {
  const id = input.id || `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const status = input.status || "pending";
  return {
    ...input,
    id,
    status,
    createdAt: input.createdAt || new Date().toISOString(),
    resumeAction: input.resumeAction || (status === "pending" ? resumeActionFor(input.kind, id) : undefined),
  };
}

export function resumeActionFor(kind: ActionRequiredKind, id: string): ResumeAction {
  return {
    type: kind === "question"
      ? "question"
      : kind === "patchReview"
        ? "patchReview"
        : kind === "verification"
          ? "verification"
          : "approval",
    payloadId: id,
  };
}

export function resolveActionRequiredEvent(
  event: ActionRequiredEvent,
  resolution: ActionResolution,
): ActionRequiredEvent {
  const status = resolution.status
    || (typeof resolution.approved === "boolean" ? (resolution.approved ? "approved" : "denied") : "resolved");
  const next = {
    ...event,
    status,
    answer: resolution.answer === null ? undefined : resolution.answer ?? event.answer,
    reason: resolution.reason ?? event.reason,
    resolvedAt: resolution.resolvedAt || new Date().toISOString(),
    toolResultText: resolution.toolResultText ?? event.toolResultText,
  };
  return {
    ...next,
    toolResultText: next.toolResultText || actionRequiredToolResult(next),
  };
}

export function actionRequiredResolution(event: ActionRequiredEvent): ActionRequiredResolution {
  return {
    status: event.status,
    toolResultText: actionRequiredToolResult(event),
    resumeAction: event.resumeAction,
    resolvedAt: event.resolvedAt,
    answer: event.answer,
  };
}

export function actionRequiredToolResult(event: ActionRequiredEvent): string {
  if (event.toolResultText) return event.toolResultText;

  if (event.kind === "question") {
    if (event.status === "approved" || event.status === "resolved") {
      return event.answer ? `User answered: ${event.answer}` : "User answered the question.";
    }
    if (event.status === "expired") return "User question expired before an answer was provided.";
    return "User ignored/cancelled question.";
  }

  const target = event.tool || event.kind;
  if (event.status === "approved" || event.status === "resolved") {
    return `Approved ${target}: ${event.description}`;
  }
  if (event.status === "expired") {
    return `Expired ${target}: no user decision was provided in time.`;
  }
  if (event.status === "cancelled") {
    return `Cancelled ${target}: user cancelled the action.`;
  }
  return `Denied ${target}: ${event.reason || event.description}`;
}

export function replayPendingActionRequired(events: ActionRequiredEvent[]): ActionRequiredEvent[] {
  return events
    .filter((event) => event.status === "pending")
    .map((event) => ({
      ...event,
      resumeAction: event.resumeAction || resumeActionFor(event.kind, event.id),
    }));
}
