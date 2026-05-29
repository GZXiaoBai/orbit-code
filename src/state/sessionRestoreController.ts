import type { ActionRequiredEvent } from "../domain/actionRequired";
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
  explicitContinueRequired: boolean;
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
    const explicitContinueRequired = pendingActions.length > 0
      || input.agentRunSession?.canContinue === true
      || lastTerminal?.recoveredState === "unknown-needs-continue";
    return {
      mode: pendingActions.length > 0 ? "pending-action" : ledger.threadEvents.length > 0 ? "read-only" : "empty",
      eventCount: ledger.threadEvents.length,
      pendingActions,
      lastTerminal,
      lastCheckpoint,
      explicitContinueRequired,
      summary: eventSummary(lastItem(ledger.threadEvents)),
    };
  }

  restore(input: SessionRestoreInput): SessionRestoreResult {
    const ledger = this.buildLedger(input);
    const snapshot = ledger.ledgerSnapshot();
    const recoveredTerminals = snapshot.terminalRuns.map(recoverTerminalRun);
    const recoveredLedger = new RuntimeLedger({
      threadEvents: snapshot.threadEvents,
      actionRequired: snapshot.actionRequired,
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
