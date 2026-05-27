import { describe, expect, it } from "vitest";
import { createAgentRunSession, reduceAgentRunSession } from "../domain/agentRunSession";

describe("agent run session reducer", () => {
  it("starts a single task session", () => {
    const session = reduceAgentRunSession(createAgentRunSession("t0"), {
      type: "start",
      taskId: "task-1",
      at: "t1",
    });

    expect(session).toMatchObject({
      workspacePath: undefined,
      threadId: undefined,
      taskId: "task-1",
      phase: "planning",
      patchProposalIds: [],
      terminalRunIds: [],
      updatedAt: "t1",
    });
  });

  it("binds a run to workspace and thread scope", () => {
    const session = reduceAgentRunSession(createAgentRunSession("t0"), {
      type: "start",
      taskId: "task-1",
      workspacePath: "/tmp/project",
      threadId: "thread-1",
      at: "t1",
    });

    expect(session.id).toContain("run-");
    expect(session.workspacePath).toBe("/tmp/project");
    expect(session.threadId).toBe("thread-1");
    expect(session.iteration).toBe(0);

    const iterated = reduceAgentRunSession(session, {
      type: "iteration",
      iteration: 3,
      conversationSummary: "assistant: proposed run_command",
      at: "t2",
    });
    expect(iterated.iteration).toBe(3);
    expect(iterated.conversationSummary).toContain("run_command");
  });

  it("tracks approvals, patches, terminals, and completion", () => {
    let session = reduceAgentRunSession(createAgentRunSession("t0"), { type: "start", taskId: "task-1", at: "t1" });
    session = reduceAgentRunSession(session, { type: "approval", approvalId: "approval-1", at: "t2" });
    session = reduceAgentRunSession(session, { type: "patch", patchProposalId: "patch-1", at: "t3" });
    session = reduceAgentRunSession(session, { type: "terminal", terminalRunId: "terminal-1", at: "t4" });
    expect(session.resumeKind).toBe("verification");
    session = reduceAgentRunSession(session, { type: "complete", phase: "done", at: "t5" });

    expect(session.pendingApprovalId).toBeUndefined();
    expect(session.resumeKind).toBeUndefined();
    expect(session.canContinue).toBe(false);
    expect(session.patchProposalIds).toEqual(["patch-1"]);
    expect(session.terminalRunIds).toEqual(["terminal-1"]);
    expect(session.phase).toBe("done");
  });

  it("clears a pending approval after approve or deny resolution", () => {
    let session = reduceAgentRunSession(createAgentRunSession("t0"), { type: "start", taskId: "task-1", at: "t1" });
    session = reduceAgentRunSession(session, { type: "approval", approvalId: "approval-1", at: "t2" });
    expect(session.pendingApprovalId).toBe("approval-1");
    expect(session.resumeKind).toBe("approval");

    session = reduceAgentRunSession(session, { type: "approval", approvalId: undefined, at: "t3" });
    expect(session.pendingApprovalId).toBeUndefined();
    expect(session.resumeKind).toBeUndefined();
    expect(session.updatedAt).toBe("t3");
  });

  it("tracks pending question recovery", () => {
    let session = reduceAgentRunSession(createAgentRunSession("t0"), { type: "start", taskId: "task-1", at: "t1" });
    session = reduceAgentRunSession(session, { type: "question", questionId: "question-1", at: "t2" });

    expect(session.pendingQuestionId).toBe("question-1");
    expect(session.resumeKind).toBe("question");
  });

  it("pauses after a user action until explicit continue", () => {
    let session = reduceAgentRunSession(createAgentRunSession("t0"), { type: "start", taskId: "task-1", at: "t1" });
    session = reduceAgentRunSession(session, {
      type: "pauseForContinue",
      resumeKind: "approval",
      resumeAction: { type: "approval", payloadId: "approval-1" },
      lastToolResult: "Approved run_command",
      at: "t2",
    });

    expect(session.canContinue).toBe(true);
    expect(session.resumeAction).toEqual({ type: "approval", payloadId: "approval-1" });
    expect(session.lastToolResult).toBe("Approved run_command");

    session = reduceAgentRunSession(session, { type: "continue", at: "t3" });
    expect(session.canContinue).toBe(false);
    expect(session.resumeKind).toBeUndefined();
    expect(session.resumeAction).toBeUndefined();
    expect(session.lastToolResult).toBeUndefined();
  });

  it("resumes the same run scope without clearing patch or terminal history", () => {
    let session = reduceAgentRunSession(createAgentRunSession("t0"), {
      type: "start",
      taskId: "task-1",
      workspacePath: "/tmp/project",
      threadId: "thread-1",
      at: "t1",
    });
    const runId = session.id;
    session = reduceAgentRunSession(session, { type: "patch", patchProposalId: "patch-1", at: "t2" });
    session = reduceAgentRunSession(session, { type: "terminal", terminalRunId: "terminal-1", at: "t3" });
    session = reduceAgentRunSession(session, {
      type: "pauseForContinue",
      resumeKind: "verification",
      resumeAction: { type: "verification", payloadId: "terminal-1" },
      lastToolResult: "Verification passed",
      at: "t4",
    });

    session = reduceAgentRunSession(session, { type: "continue", at: "t5" });
    session = reduceAgentRunSession(session, { type: "resume", at: "t6" });

    expect(session.id).toBe(runId);
    expect(session.workspacePath).toBe("/tmp/project");
    expect(session.threadId).toBe("thread-1");
    expect(session.taskId).toBe("task-1");
    expect(session.patchProposalIds).toEqual(["patch-1"]);
    expect(session.terminalRunIds).toEqual(["terminal-1"]);
    expect(session.phase).toBe("planning");
    expect(session.canContinue).toBe(false);
  });
});
