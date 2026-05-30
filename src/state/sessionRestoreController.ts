import { resumeActionFor, type ActionRequiredEvent } from "../domain/actionRequired";
import type { AgentRunSession } from "../domain/agentRunSession";
import { recoverTerminalRun, type TerminalRun } from "../domain/terminalRun";
import type { ThreadEvent } from "../domain/threadEvents";
import { RuntimeLedger, type RuntimeLedgerSnapshot, type ThreadRuntimeSnapshot } from "./threadRuntimeStore";
import { ResumeController, type ResumeResult } from "./resumeController";

export type RestoreMode = "pending-action" | "read-only" | "empty";

export interface SessionRestoreInput {
  runtimeLedgerSnapshot?: ThreadRuntimeSnapshot | null;
  agentRunSession?: AgentRunSession | null;
  threadEvents?: ThreadEvent[];
  actionRequired?: ActionRequiredEvent[];
  terminalRuns?: TerminalRun[];
}

export interface SessionRestorePreview {
  mode: RestoreMode;
  eventCount: number;
  pendingActions: ActionRequiredEvent[];
  lastTerminal?: TerminalRun;
  lastCheckpoint?: ThreadEvent;
  lastEventSummary: string;
  explicitContinueRequired: boolean;
  restorable: boolean;
  errors: string[];
  warnings: string[];
  summary: string;
}

export interface SessionRestoreResult extends SessionRestorePreview {
  ledger: RuntimeLedgerSnapshot;
  resumeResults: ResumeResult[];
  agentRunSession?: AgentRunSession | null;
}

function lastItem<T>(items: T[]): T | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined;
}

function eventSummary(event?: ThreadEvent): string {
  if (!event) return "No runtime history.";
  return event.message || event.title || event.kind;
}

function snapshotLooksCorrupted(runtime?: ThreadRuntimeSnapshot | null): boolean {
  if (!runtime) return false;
  return (runtime.threadEvents !== undefined && runtime.threadEvents !== null && !Array.isArray(runtime.threadEvents))
    || (runtime.actionRequired !== undefined && runtime.actionRequired !== null && !Array.isArray(runtime.actionRequired))
    || (runtime.toolCalls !== undefined && runtime.toolCalls !== null && !Array.isArray(runtime.toolCalls))
    || (runtime.terminalRuns !== undefined && runtime.terminalRuns !== null && !Array.isArray(runtime.terminalRuns))
    || (runtime.checkpointRuntimeSnapshots !== undefined
      && runtime.checkpointRuntimeSnapshots !== null
      && (typeof runtime.checkpointRuntimeSnapshots !== "object" || Array.isArray(runtime.checkpointRuntimeSnapshots)));
}

function replayPendingActions(actions: ActionRequiredEvent[]): ActionRequiredEvent[] {
  return actions.map((action) => action.status === "pending" ? {
    ...action,
    resumeAction: action.resumeAction || resumeActionFor(action.kind, action.id),
  } : { ...action });
}

export class SessionRestoreController {
  private resumeController: ResumeController;

  constructor(resumeController = new ResumeController()) {
    this.resumeController = resumeController;
  }

  preview(input: SessionRestoreInput): SessionRestorePreview {
    const ledger = this.buildLedger(input).ledgerSnapshot();
    const pendingActions = ledger.actionRequired.filter((action) => action.status === "pending");
    const terminalRuns = ledger.terminalRuns.map(recoverTerminalRun);
    const lastTerminal = lastItem(terminalRuns);
    const lastCheckpoint = lastItem(ledger.checkpoints);
    const lastEventSummary = eventSummary(lastItem(ledger.threadEvents));
    const errors = snapshotLooksCorrupted(input.runtimeLedgerSnapshot)
      ? ["Runtime ledger snapshot is corrupted or has invalid collection fields."]
      : [];
    const checkpointRuntimeSnapshots = ledger.checkpointRuntimeSnapshots || {};
    const warnings = [
      ...pendingActions
        .filter((action) => !action.resumeAction)
        .map((action) => `Pending ${action.kind} action ${action.id} is missing resumeAction and will be replayed explicitly.`),
      ...(lastTerminal?.recoveredState === "unknown-needs-continue"
        ? [`Terminal ${lastTerminal.id} was running before restore and is now unknown-needs-continue.`]
        : []),
      ...ledger.checkpoints
        .filter((event) => {
          const checkpointId = event.checkpoint?.checkpointId;
          return checkpointId && !checkpointRuntimeSnapshots[checkpointId];
        })
        .map((event) => `Checkpoint ${event.checkpoint!.checkpointId} has no runtime snapshot.`),
    ];
    const explicitContinueRequired = pendingActions.length > 0
      || input.agentRunSession?.canContinue === true
      || lastTerminal?.recoveredState === "unknown-needs-continue";
    return {
      mode: pendingActions.length > 0 ? "pending-action" : ledger.threadEvents.length > 0 ? "read-only" : "empty",
      eventCount: ledger.threadEvents.length,
      pendingActions,
      lastTerminal,
      lastCheckpoint,
      lastEventSummary,
      explicitContinueRequired,
      restorable: errors.length === 0,
      errors,
      warnings,
      summary: lastEventSummary,
    };
  }

  restore(input: SessionRestoreInput): SessionRestoreResult {
    const sourcePreview = this.preview(input);
    const ledger = this.buildLedger(input);
    const snapshot = ledger.ledgerSnapshot();
    const recoveredTerminals = snapshot.terminalRuns.map(recoverTerminalRun);
    const recoveredActions = replayPendingActions(snapshot.actionRequired);
    const recoveredLedger = new RuntimeLedger({
      threadEvents: snapshot.threadEvents,
      actionRequired: recoveredActions,
      toolCalls: snapshot.toolCalls,
      terminalRuns: recoveredTerminals,
      checkpointRuntimeSnapshots: snapshot.checkpointRuntimeSnapshots,
    }).ledgerSnapshot();
    const preview = this.preview({
      ...input,
      runtimeLedgerSnapshot: {
        threadEvents: recoveredLedger.threadEvents,
        actionRequired: recoveredLedger.actionRequired,
        toolCalls: recoveredLedger.toolCalls,
        terminalRuns: recoveredLedger.terminalRuns,
        checkpointRuntimeSnapshots: recoveredLedger.checkpointRuntimeSnapshots,
      },
    });
    const resumeResults = [
      ...preview.pendingActions.map((action) => this.resumeController.resume({
        kind: action.resumeAction?.type || (action.kind === "question" ? "question" : action.kind === "patchReview" ? "patchReview" : action.kind === "verification" ? "verification" : "approval"),
        resumeAction: action.resumeAction || { type: action.kind === "question" ? "question" : action.kind === "patchReview" ? "patchReview" : action.kind === "verification" ? "verification" : "approval", payloadId: action.id },
        toolResultText: action.toolResultText || `${action.title} is pending after restore.`,
        message: "恢复的阻塞动作需要用户处理；处理后仍需显式 Continue。",
      })),
      ...recoveredTerminals
        .filter((run) => run.recoveredState === "unknown-needs-continue")
        .map((run) => this.resumeController.terminalRecovery(run)),
    ];

    return {
      ...preview,
      errors: Array.from(new Set([...sourcePreview.errors, ...preview.errors])),
      warnings: Array.from(new Set([...sourcePreview.warnings, ...preview.warnings])),
      restorable: sourcePreview.restorable && preview.restorable,
      ledger: recoveredLedger,
      resumeResults,
      agentRunSession: input.agentRunSession,
    };
  }

  private buildLedger(input: SessionRestoreInput): RuntimeLedger {
    const runtime = input.runtimeLedgerSnapshot;
    return new RuntimeLedger({
      threadEvents: runtime?.threadEvents || input.threadEvents || [],
      actionRequired: runtime?.actionRequired || input.actionRequired || [],
      toolCalls: runtime?.toolCalls || [],
      terminalRuns: runtime?.terminalRuns || input.terminalRuns || [],
      checkpointRuntimeSnapshots: runtime?.checkpointRuntimeSnapshots || {},
    });
  }
}
