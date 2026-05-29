import type { QuestionRequest } from "./questionRequest";
import type { TerminalRun } from "./terminalRun";
import type { ThreadEvent } from "./threadEvents";
import type { ActionRequiredEvent } from "./actionRequired";
import type { ApprovalRequest } from "../state/useApprovalQueue";
import type { ToolCallLifecycle } from "./toolCallLifecycle";
import type { ContextInspectorModel } from "../runtime/contextProviders";

export type PendingActionKind = "approval" | "question" | "patch" | "verification" | "checkpoint" | "rollback";

export interface PendingAction {
  id: string;
  kind: PendingActionKind;
  eventId?: string;
  payloadId?: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface InspectorModel {
  selectedEvent?: ThreadEvent;
  patchEvents: ThreadEvent[];
  terminalRuns: TerminalRun[];
  historyEvents: ThreadEvent[];
  rollbackEvents: ThreadEvent[];
  checkpointEvents: ThreadEvent[];
  toolCalls: ToolCallLifecycle[];
}

export interface RuntimeLedgerSelectorSnapshot {
  threadEvents: ThreadEvent[];
  actionRequired: ActionRequiredEvent[];
  toolCalls?: ToolCallLifecycle[];
  terminalRuns?: TerminalRun[];
  checkpoints?: ThreadEvent[];
}

export interface CheckpointBrowserModel {
  checkpoints: ThreadEvent[];
  selected?: ThreadEvent;
  restorePreview?: {
    checkpointId: string;
    filePaths: string[];
    strategy?: string;
    canRestore: boolean;
  };
  errors: string[];
}

export interface ContextMemoryModel {
  activeBlocks: ContextInspectorModel["blocks"];
  disabledBlocks: ContextInspectorModel["disabledBlocks"];
  memories: ContextInspectorModel["blocks"];
  externalRuleCandidates: Array<{ path: string; title: string; enabled: false }>;
  lastRefreshedAt?: string;
  permissionImpact: "none";
}

function eventCreatedAt(event: ThreadEvent): string {
  return event.createdAt || event.timestamp;
}

function isPendingPatchEvent(event: ThreadEvent): boolean {
  return Boolean(event.patches?.some((patch) => !patch.applied));
}

function toEvents(input: ThreadEvent[] | RuntimeLedgerSelectorSnapshot): ThreadEvent[] {
  return Array.isArray(input) ? input : input.threadEvents;
}

export function selectCenterTimeline(input: ThreadEvent[] | RuntimeLedgerSelectorSnapshot): ThreadEvent[] {
  return toEvents(input).filter((event) => {
    if (event.kind === "toolCall" && event.toolCall?.params) return false;
    if (event.kind === "terminalRun" && event.terminalRun?.output) return false;
    return true;
  });
}

export function selectPendingActions(input: RuntimeLedgerSelectorSnapshot | {
  events: ThreadEvent[];
  actionRequired?: ActionRequiredEvent[];
  approvals?: ApprovalRequest[];
  questions?: QuestionRequest[];
}): PendingAction[] {
  const actions: PendingAction[] = [];
  const events = "threadEvents" in input ? input.threadEvents : input.events;
  const actionRequired = "threadEvents" in input ? input.actionRequired : input.actionRequired || [];

  for (const action of actionRequired) {
    if (action.status !== "pending") continue;
    const kind = action.kind === "command" || action.kind === "install" || action.kind === "network" || action.kind === "write"
      ? "approval"
      : action.kind === "patchReview"
        ? "patch"
        : action.kind;
    actions.push({
      id: `action:${action.id}`,
      kind,
      payloadId: action.id,
      title: action.title,
      detail: action.question || action.description,
      createdAt: action.createdAt,
    });
  }

  for (const request of ("threadEvents" in input ? [] : input.approvals || [])) {
    if (request.status !== "pending") continue;
    const isVerification = request.tool === "run_command" && typeof request.params.sourceEventId === "string";
    actions.push({
      id: `approval:${request.id}`,
      kind: isVerification ? "verification" : "approval",
      payloadId: request.id,
      title: isVerification ? "Verification Approval" : "Approval",
      detail: request.reason || request.tool,
      createdAt: request.createdAt,
    });
  }

  for (const question of ("threadEvents" in input ? [] : input.questions || [])) {
    if (question.status !== "pending") continue;
    actions.push({
      id: `question:${question.id}`,
      kind: "question",
      payloadId: question.id,
      title: "Question",
      detail: question.question,
      createdAt: question.createdAt,
    });
  }

  for (const event of events) {
    if (isPendingPatchEvent(event)) {
      actions.push({
        id: `patch:${event.id}`,
        kind: "patch",
        eventId: event.id,
        title: event.title,
        detail: event.patches?.map((patch) => patch.path).join(", ") || event.message,
        createdAt: eventCreatedAt(event),
      });
    }
    if (event.rollback?.status === "pending" || event.rollback?.status === "running") {
      actions.push({
        id: `rollback:${event.id}`,
        kind: "rollback",
        eventId: event.id,
        title: event.title,
        detail: event.message,
        createdAt: eventCreatedAt(event),
      });
    }
  }

  return actions.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function selectInspectorModel(input: ThreadEvent[] | RuntimeLedgerSelectorSnapshot, selectedEventId?: string, terminalRuns: TerminalRun[] = []): InspectorModel {
  const events = toEvents(input);
  const ledgerTerminalRuns = Array.isArray(input) ? terminalRuns : input.terminalRuns || terminalRuns;
  const toolCalls = Array.isArray(input) ? [] : input.toolCalls || [];
  const selectedEvent = selectedEventId ? events.find((event) => event.id === selectedEventId) : undefined;
  return {
    selectedEvent,
    patchEvents: events.filter((event) => event.patches?.length).reverse(),
    terminalRuns: ledgerTerminalRuns,
    historyEvents: events.filter((event) =>
      event.kind === "approval"
      || event.kind === "question"
      || event.kind === "patchProposal"
      || event.kind === "verification"
      || event.kind === "checkpoint"
      || event.kind === "rollback"
      || event.kind === "error"
    ).reverse(),
    rollbackEvents: events.filter((event) => event.kind === "rollback").reverse(),
    checkpointEvents: events.filter((event) => event.kind === "checkpoint" || Boolean(event.checkpoint)).reverse(),
    toolCalls,
  };
}

export function selectCheckpointBrowserModel(
  input: RuntimeLedgerSelectorSnapshot,
  selectedCheckpointId?: string,
): CheckpointBrowserModel {
  const checkpoints = (input.checkpoints?.length ? input.checkpoints : input.threadEvents.filter((event) => event.kind === "checkpoint" || Boolean(event.checkpoint))).reverse();
  const selected = selectedCheckpointId
    ? checkpoints.find((event) => event.checkpoint?.checkpointId === selectedCheckpointId || event.id === selectedCheckpointId)
    : checkpoints[0];
  const errors = checkpoints
    .filter((event) => event.checkpoint?.status === "failed")
    .map((event) => event.checkpoint?.error || event.message);
  return {
    checkpoints,
    selected,
    restorePreview: selected?.checkpoint ? {
      checkpointId: selected.checkpoint.checkpointId,
      filePaths: selected.checkpoint.filePaths,
      strategy: selected.checkpoint.strategy,
      canRestore: selected.checkpoint.status === "created",
    } : undefined,
    errors,
  };
}

export function selectContextMemoryModel(
  inspector: ContextInspectorModel,
  externalRuleCandidates: Array<{ path: string; title: string }> = [],
): ContextMemoryModel {
  const candidates = externalRuleCandidates.length > 0
    ? externalRuleCandidates.map((candidate) => ({ ...candidate, enabled: false as const }))
    : inspector.externalRuleCandidates;
  return {
    activeBlocks: inspector.blocks,
    disabledBlocks: inspector.disabledBlocks,
    memories: inspector.blocks.filter((block) => /memory|rule|ORBIT|skill/i.test(`${block.source} ${block.title}`)),
    externalRuleCandidates: candidates,
    lastRefreshedAt: inspector.lastCollectedAt,
    permissionImpact: "none",
  };
}
