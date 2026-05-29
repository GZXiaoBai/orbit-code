import { describe, expect, it } from "vitest";
import type { AgentEventPatch } from "../domain/agentEvents";
import { createQuestionRequest } from "../domain/questionRequest";
import type { ThreadEvent } from "../domain/threadEvents";
import { createTerminalRun } from "../domain/terminalRun";
import { createApprovalRequest } from "../state/useApprovalQueue";
import { buildReviewDockModel } from "../features/review/reviewDockModel";

describe("review dock queue model", () => {
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

  it("groups command, question, patch, verification, and terminal queues", () => {
    const command = createApprovalRequest("run_command", { command: "npm", args: ["test"] });
    const verification = createApprovalRequest("run_command", {
      command: "npm",
      args: ["run", "build"],
      sourceEventId: "patch-1",
    });
    const question = createQuestionRequest({ taskId: "task-1", question: "Which target?" });
    const pendingPatchEvent = patchEvent({
      patches: [{ path: "a.ts", oldContent: "a", newContent: "b", applied: false }],
    });
    const appliedPatchEvent = patchEvent({
      id: "patch-2",
      patches: [{ path: "done.ts", oldContent: "a", newContent: "b", applied: true }],
    });
    const terminal = createTerminalRun({ taskId: "task-1", command: "npm", args: ["test"], status: "done", exitCode: 0 });

    const model = buildReviewDockModel({
      approvals: [command, verification],
      questions: [question],
      events: [pendingPatchEvent, appliedPatchEvent],
      terminalRuns: [terminal],
    });

    expect(model.commandApprovals).toHaveLength(1);
    expect(model.verificationApprovals).toHaveLength(1);
    expect(model.questions).toHaveLength(1);
    expect(model.patchReviews).toHaveLength(1);
    expect(model.appliedPatchReviews).toHaveLength(1);
    expect(model.terminalRuns).toHaveLength(1);
    expect(model.counts.changes).toBe(1);
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
      approvals: [],
      questions: [],
      events: [oldPatch, newPatch],
      terminalRuns: [],
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
      approvals: [],
      questions: [],
      events: [failedPatch],
      terminalRuns: [],
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
      approvals: [],
      questions: [],
      events: [conflictPatch],
      terminalRuns: [],
    });

    expect(model.patchReviews.map((event) => event.id)).toEqual(["patch-conflict"]);
    expect(model.failedPatchReviews).toHaveLength(0);
    expect(model.counts.changes).toBe(1);
  });

  it("scopes queues to the active workspace, thread, and task", () => {
    const currentCommand = createApprovalRequest("run_command", {
      command: "npm",
      args: ["test"],
      workspacePath: "/tmp/project",
      threadId: "thread-a",
      taskId: "task-a",
    });
    const otherCommand = createApprovalRequest("run_command", {
      command: "npm",
      args: ["build"],
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
      approvals: [currentCommand, otherCommand],
      questions: [],
      events: [currentPatch, otherPatch],
      terminalRuns: [currentTerminal, otherTerminal],
      workspacePath: "/tmp/project",
      threadId: "thread-a",
      taskId: "task-a",
    });

    expect(model.commandApprovals.map((item) => item.params.command)).toEqual(["npm"]);
    expect(model.patchReviews.map((event) => event.id)).toEqual(["patch-current"]);
    expect(model.historyPatchReviews.map((event) => event.id)).toEqual(["patch-other"]);
    expect(model.terminalRuns.map((run) => run.taskId)).toEqual(["task-a"]);
    expect(model.historyTerminalRuns.map((run) => run.taskId)).toEqual(["task-b"]);
  });
});
