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
      errors: [],
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
