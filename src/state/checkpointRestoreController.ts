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
    if (!input.runtimeSnapshot) errors.push("Missing runtime snapshot for checkpoint.");
    if (!checkpoint && filePaths.length === 0) errors.push("Missing checkpoint file metadata.");
    return {
      checkpointId: input.checkpointId,
      restorable: Boolean(input.runtimeSnapshot),
      filePaths,
      strategy: checkpoint?.strategy,
      reason: input.checkpointEvent?.message || "Restore checkpoint runtime state.",
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
    const hasPendingPatchReview = restoredSnapshot.actionRequired.some((action) => action.kind === "patchReview" && action.status === "pending");
    const action = hasPendingPatchReview
      ? restoredSnapshot.actionRequired.find((item) => item.kind === "patchReview" && item.status === "pending")!
      : createActionRequiredEvent({
        id: `checkpoint-restore-action-${input.checkpointId}`,
        kind: "patchReview",
        workspacePath: input.runtimeSnapshot.workspacePath || input.fallbackWorkspacePath,
        threadId: input.runtimeSnapshot.threadId || input.fallbackThreadId,
        sourceEventId: input.checkpointEvent?.id,
        title: "Checkpoint Restored",
        description: `Checkpoint ${input.checkpointId} was restored. Review or continue explicitly before model execution resumes.`,
      });
    if (!hasPendingPatchReview) {
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
