import { describe, expect, it } from "vitest";
import type { AgentEventPatch } from "../domain/agentEvents";
import { createActionRequiredEvent } from "../domain/actionRequired";
import type { RuntimeLedgerSelectorSnapshot } from "../domain/threadEventSelectors";
import type { ThreadEvent } from "../domain/threadEvents";
import { createTerminalRun } from "../domain/terminalRun";
import { buildReviewDockModel } from "../features/review/reviewDockModel";

describe("review dock inspector model", () => {
  function patchEvent(overrides: Partial<ThreadEvent> & { patches: AgentEventPatch[] }): ThreadEvent {
    return {
      id: "patch-1",
      kind: "patchProposal",
      role: "coder",
      title: "Patch Proposal",
      status: "done",
      message: "patch",
      timestamp: "12:00",
      ...overrides,
    };
  }

  function ledger(partial: Partial<RuntimeLedgerSelectorSnapshot>): RuntimeLedgerSelectorSnapshot {
    return {
      threadEvents: [],
      actionRequired: [],
      toolCalls: [],
      terminalRuns: [],
      checkpoints: [],
      ...partial,
    };
  }

  it("projects questions, patches, and terminal details from the ledger snapshot", () => {
    const question = createActionRequiredEvent({
      id: "question-1",
      kind: "question",
      title: "Question",
      description: "Which target?",
      question: "Which target?",
    });
    const pendingPatchEvent = patchEvent({
      patches: [{ path: "a.ts", oldContent: "a", newContent: "b", applied: false }],
    });
    const appliedPatchEvent = patchEvent({
      id: "patch-2",
      patches: [{ path: "done.ts", oldContent: "a", newContent: "b", applied: true }],
    });
    const terminal = createTerminalRun({ taskId: "task-1", command: "npm", args: ["test"], status: "done", exitCode: 0 });

    const model = buildReviewDockModel({
      ledger: ledger({
        threadEvents: [pendingPatchEvent, appliedPatchEvent],
        actionRequired: [question],
        terminalRuns: [terminal],
      }),
    });

    expect(model.actionRequired).toHaveLength(1);
    expect(model.patchReviews).toHaveLength(1);
    expect(model.appliedPatchReviews).toHaveLength(1);
    expect(model.terminalRuns).toHaveLength(1);
    expect(model.counts.changes).toBe(1);
    expect(model.counts.questions).toBe(1);
  });

  it("orders pending patch reviews newest first", () => {
    const oldPatch = patchEvent({
      id: "patch-old",
      message: "old",
      timestamp: "12:00",
      patches: [{ path: "old.ts", oldContent: "a", newContent: "b", applied: false }],
    });
    const newPatch = patchEvent({
      id: "patch-new",
      message: "new",
      timestamp: "12:05",
      patches: [{ path: "new.ts", oldContent: "a", newContent: "b", applied: false }],
    });

    const model = buildReviewDockModel({
      ledger: ledger({ threadEvents: [oldPatch, newPatch] }),
    });

    expect(model.patchReviews.map((event) => event.id)).toEqual(["patch-new", "patch-old"]);
  });

  it("keeps failed sandbox previews pending so users can retry", () => {
    const failedPatch = patchEvent({
      id: "patch-failed",
      message: "failed",
      timestamp: "12:10",
      patches: [{
        path: "vite.config.ts",
        oldContent: "old",
        newContent: "new",
        applied: false,
        sandboxStatus: "failed",
        applyStatus: "failed",
      }],
    });

    const model = buildReviewDockModel({
      ledger: ledger({ threadEvents: [failedPatch] }),
    });

    expect(model.patchReviews.map((event) => event.id)).toEqual(["patch-failed"]);
    expect(model.failedPatchReviews.map((event) => event.id)).toEqual(["patch-failed"]);
    expect(model.counts.changes).toBe(1);
  });

  it("keeps merge-conflict patches pending until the user resolves them", () => {
    const conflictPatch = patchEvent({
      id: "patch-conflict",
      message: "conflict",
      timestamp: "12:10",
      patches: [{
        path: "src/App.tsx",
        oldContent: "old",
        newContent: "new",
        applied: false,
        sandboxStatus: "sandboxed",
        applyStatus: "failed",
        hasConflict: true,
        conflictContent: "<<<<<<< AI\nnew\n=======\nlocal\n>>>>>>> LOCAL\n",
      }],
    });

    const model = buildReviewDockModel({
      ledger: ledger({ threadEvents: [conflictPatch] }),
    });

    expect(model.patchReviews.map((event) => event.id)).toEqual(["patch-conflict"]);
    expect(model.failedPatchReviews).toHaveLength(0);
    expect(model.counts.changes).toBe(1);
  });

  it("scopes inspector details to the active workspace, thread, and task", () => {
    const currentAction = createActionRequiredEvent({
      id: "action-current",
      kind: "command",
      tool: "run_command",
      title: "Run command",
      description: "npm test",
      workspacePath: "/tmp/project",
      threadId: "thread-a",
      taskId: "task-a",
    });
    const otherAction = createActionRequiredEvent({
      id: "action-other",
      kind: "command",
      tool: "run_command",
      title: "Run command",
      description: "npm build",
      workspacePath: "/tmp/project",
      threadId: "thread-b",
      taskId: "task-b",
    });
    const currentPatch = patchEvent({
      id: "patch-current",
      workspacePath: "/tmp/project",
      threadId: "thread-a",
      taskId: "task-a",
      message: "current",
      timestamp: "12:00",
      patches: [{ path: "a.ts", oldContent: "a", newContent: "b", applied: false }],
    });
    const otherPatch: ThreadEvent = {
      ...currentPatch,
      id: "patch-other",
      threadId: "thread-b",
      taskId: "task-b",
    };
    const currentTerminal = createTerminalRun({
      workspacePath: "/tmp/project",
      threadId: "thread-a",
      taskId: "task-a",
      command: "npm",
      args: ["test"],
    });
    const otherTerminal = createTerminalRun({
      workspacePath: "/tmp/project",
      threadId: "thread-b",
      taskId: "task-b",
      command: "npm",
      args: ["build"],
    });

    const model = buildReviewDockModel({
      ledger: ledger({
        threadEvents: [currentPatch, otherPatch],
        actionRequired: [currentAction, otherAction],
        terminalRuns: [currentTerminal, otherTerminal],
      }),
      workspacePath: "/tmp/project",
      threadId: "thread-a",
      taskId: "task-a",
    });

    expect(model.actionRequired.map((item) => item.id)).toEqual(["action-current"]);
    expect(model.patchReviews.map((event) => event.id)).toEqual(["patch-current"]);
    expect(model.historyPatchReviews.map((event) => event.id)).toEqual(["patch-other"]);
    expect(model.terminalRuns.map((run) => run.taskId)).toEqual(["task-a"]);
    expect(model.historyTerminalRuns.map((run) => run.taskId)).toEqual(["task-b"]);
  });
});
