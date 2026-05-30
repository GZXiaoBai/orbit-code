import { createActionRequiredEvent, type ActionRequiredEvent } from "../domain/actionRequired";
import type { ThreadEvent } from "../domain/threadEvents";
import { createThreadEvent } from "../domain/threadEvents";
import { RuntimeLedger, type CheckpointRuntimeSnapshot, type RuntimeLedgerSnapshot } from "./threadRuntimeStore";

export interface CheckpointRestorePreview {
  checkpointId: string;
  restorable: boolean;
  filePaths: string[];
  strategy?: string;
  reason: string;
  drySummary: string;
  linkedActionId?: string;
  linkedToolCallId?: string;
  linkedEventId?: string;
  recreateActionKind: "patchReview" | "verification";
  status: "valid" | "missing-runtime" | "missing-files" | "corrupted" | "non-restorable";
  errors: string[];
}

export interface CheckpointRestoreResult {
  preview: CheckpointRestorePreview;
  ledger: RuntimeLedgerSnapshot;
  restoreEvent: ThreadEvent;
  action: ActionRequiredEvent;
}

export class CheckpointRestoreController {
  preview(input: {
    checkpointId: string;
    checkpointEvent?: ThreadEvent;
    runtimeSnapshot?: CheckpointRuntimeSnapshot;
  }): CheckpointRestorePreview {
    const checkpoint = input.checkpointEvent?.checkpoint;
    const filePaths = checkpoint?.filePaths || [];
    const errors: string[] = [];
    let status: CheckpointRestorePreview["status"] = "valid";
    if (!input.runtimeSnapshot) {
      status = "missing-runtime";
      errors.push("Missing runtime snapshot for checkpoint.");
    } else if (!input.runtimeSnapshot.runtimeLedgerSnapshot || typeof input.runtimeSnapshot.runtimeLedgerSnapshot !== "object") {
      status = "corrupted";
      errors.push("Checkpoint runtime snapshot is corrupted.");
    }
    if (!checkpoint || filePaths.length === 0) {
      status = status === "valid" ? "missing-files" : status;
      errors.push("Missing checkpoint file metadata.");
    }
    if (checkpoint?.status === "failed") {
      status = "non-restorable";
      errors.push(checkpoint.error || "Checkpoint creation failed.");
    }
    const restoredSnapshot = input.runtimeSnapshot && status !== "corrupted"
      ? new RuntimeLedger(input.runtimeSnapshot.runtimeLedgerSnapshot).ledgerSnapshot()
      : undefined;
    const linkedAction = restoredSnapshot?.actionRequired.find((action) =>
      (action.kind === "patchReview" || action.kind === "verification")
      && (action.status === "pending" || action.sourceEventId === input.checkpointEvent?.id)
    );
    const linkedToolCall = linkedAction
      ? restoredSnapshot?.toolCalls.find((call) => call.actionRequiredId === linkedAction.id)
      : restoredSnapshot?.toolCalls.find((call) => call.threadEventId === input.checkpointEvent?.id);
    const recreateActionKind = linkedAction?.kind === "verification" ? "verification" : "patchReview";
    const strategy = checkpoint?.strategy || "unknown";
    const drySummary = errors.length > 0
      ? `Cannot restore checkpoint ${input.checkpointId}: ${errors.join(" ")}`
      : `Restore ${filePaths.length} file${filePaths.length === 1 ? "" : "s"} using ${strategy}; runtime ledger will be restored and a ${recreateActionKind} action will require explicit Continue.`;
    return {
      checkpointId: input.checkpointId,
      restorable: status === "valid",
      filePaths,
      strategy: checkpoint?.strategy,
      reason: input.checkpointEvent?.message || "Restore checkpoint runtime state.",
      drySummary,
      linkedActionId: linkedAction?.id,
      linkedToolCallId: linkedToolCall?.id,
      linkedEventId: input.checkpointEvent?.id,
      recreateActionKind,
      status,
      errors,
    };
  }

  restore(input: {
    checkpointId: string;
    checkpointEvent?: ThreadEvent;
    runtimeSnapshot: CheckpointRuntimeSnapshot;
    fallbackWorkspacePath?: string;
    fallbackThreadId?: string;
    at?: string;
  }): CheckpointRestoreResult {
    const preview = this.preview(input);
    const restored = new RuntimeLedger(input.runtimeSnapshot.runtimeLedgerSnapshot);
    const restoredSnapshot = restored.snapshot();
    const at = input.at || new Date().toISOString();
    const restoreEvent = createThreadEvent({
      id: `checkpoint-restore-${input.checkpointId}-${Date.now()}`,
      kind: "rollback",
      workspacePath: input.runtimeSnapshot.workspacePath || input.fallbackWorkspacePath,
      threadId: input.runtimeSnapshot.threadId || input.fallbackThreadId,
      role: "reviewer",
      title: "Patch Rollback",
      status: "done",
      message: `Restored checkpoint ${input.checkpointId}. Model execution requires explicit Continue.`,
      timestamp: at,
      rollback: {
        checkpointId: input.checkpointId,
        filePaths: preview.filePaths,
        status: "restored",
        actor: "user",
      },
    });
    const hasPendingRestoreAction = restoredSnapshot.actionRequired.some((action) => action.kind === preview.recreateActionKind && action.status === "pending");
    const action = hasPendingRestoreAction
      ? restoredSnapshot.actionRequired.find((item) => item.kind === preview.recreateActionKind && item.status === "pending")!
      : createActionRequiredEvent({
        id: `checkpoint-restore-action-${input.checkpointId}`,
        kind: preview.recreateActionKind,
        workspacePath: input.runtimeSnapshot.workspacePath || input.fallbackWorkspacePath,
        threadId: input.runtimeSnapshot.threadId || input.fallbackThreadId,
        sourceEventId: input.checkpointEvent?.id,
        toolCallId: preview.linkedToolCallId,
        title: "Checkpoint Restored",
        description: `Checkpoint ${input.checkpointId} was restored. Review or continue explicitly before model execution resumes.`,
        toolResultText: `Checkpoint ${input.checkpointId} restored; explicit Continue is required before model execution resumes.`,
      });
    if (!hasPendingRestoreAction) {
      restored.appendActionRequired(action);
    }
    restored.appendThreadEvent(restoreEvent);

    return {
      preview,
      ledger: restored.ledgerSnapshot(),
      restoreEvent,
      action,
    };
  }
}
