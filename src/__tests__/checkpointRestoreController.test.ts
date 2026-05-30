import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "../domain/threadEvents";
import { CheckpointRestoreController } from "../state/checkpointRestoreController";

describe("CheckpointRestoreController", () => {
  const checkpointEvent: ThreadEvent = {
    id: "checkpoint-event-1",
    kind: "checkpoint",
    role: "reviewer",
    status: "done",
    title: "Checkpoint",
    message: "Before patch",
    timestamp: "2026-05-29T00:00:00.000Z",
    checkpoint: {
      checkpointId: "checkpoint-1",
      strategy: "file-snapshot",
      filePaths: ["src/App.tsx"],
      status: "created",
    },
  };

  it("previews checkpoint restore feasibility", () => {
    const controller = new CheckpointRestoreController();

    expect(controller.preview({
      checkpointId: "checkpoint-1",
      checkpointEvent,
      runtimeSnapshot: {
        checkpointId: "checkpoint-1",
        runtimeLedgerSnapshot: { threadEvents: [] },
        createdAt: "2026-05-29T00:00:00.000Z",
      },
    })).toMatchObject({
      restorable: true,
      filePaths: ["src/App.tsx"],
      strategy: "file-snapshot",
      status: "valid",
      drySummary: "Restore 1 file using file-snapshot; runtime ledger will be restored and a patchReview action will require explicit Continue.",
      errors: [],
    });
  });

  it("reports missing runtime snapshots as non-restorable preview errors", () => {
    const controller = new CheckpointRestoreController();

    expect(controller.preview({
      checkpointId: "checkpoint-1",
      checkpointEvent,
    })).toMatchObject({
      restorable: false,
      status: "missing-runtime",
      errors: ["Missing runtime snapshot for checkpoint."],
    });
  });

  it("recreates verification action when restored runtime was waiting for verification", () => {
    const controller = new CheckpointRestoreController();
    const result = controller.restore({
      checkpointId: "checkpoint-1",
      checkpointEvent,
      runtimeSnapshot: {
        checkpointId: "checkpoint-1",
        threadId: "thread-1",
        workspacePath: "/tmp/project",
        runtimeLedgerSnapshot: {
          actionRequired: [{
            id: "verification-1",
            kind: "verification",
            title: "Verify",
            description: "npm test",
            status: "pending",
            createdAt: "2026-05-29T00:00:00.000Z",
            resumeAction: { type: "verification", payloadId: "verification-1" },
          }],
          toolCalls: [{
            id: "tool-1",
            tool: "verification",
            status: "actionRequired",
            actionRequiredId: "verification-1",
            createdAt: "2026-05-29T00:00:00.000Z",
          }],
        },
        createdAt: "2026-05-29T00:00:00.000Z",
      },
      at: "2026-05-29T00:00:01.000Z",
    });

    expect(result.preview).toMatchObject({
      recreateActionKind: "verification",
      linkedActionId: "verification-1",
      linkedToolCallId: "tool-1",
    });
    expect(result.action).toMatchObject({
      id: "verification-1",
      kind: "verification",
      status: "pending",
    });
  });

  it("restores runtime snapshot and creates a patchReview action when needed", () => {
    const controller = new CheckpointRestoreController();
    const result = controller.restore({
      checkpointId: "checkpoint-1",
      checkpointEvent,
      runtimeSnapshot: {
        checkpointId: "checkpoint-1",
        threadId: "thread-1",
        workspacePath: "/tmp/project",
        runtimeLedgerSnapshot: {
          threadEvents: [{
            id: "patch-1",
            kind: "patchProposal",
            role: "coder",
            status: "done",
            title: "Patch",
            message: "Patch before restore",
            timestamp: "2026-05-29T00:00:00.000Z",
          }],
        },
        createdAt: "2026-05-29T00:00:00.000Z",
      },
      at: "2026-05-29T00:00:01.000Z",
    });

    expect(result.ledger.threadEvents).toEqual([
      expect.objectContaining({ id: "patch-1" }),
      expect.objectContaining({ kind: "rollback", rollback: expect.objectContaining({ checkpointId: "checkpoint-1" }) }),
    ]);
    expect(result.action).toMatchObject({
      kind: "patchReview",
      status: "pending",
      workspacePath: "/tmp/project",
      threadId: "thread-1",
    });
    expect(result.ledger.actionRequired).toEqual([
      expect.objectContaining({ id: result.action.id, kind: "patchReview" }),
    ]);
  });
});
