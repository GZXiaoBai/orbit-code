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
      taskId: "task-1",
      phase: "planning",
      patchProposalIds: [],
      terminalRunIds: [],
      updatedAt: "t1",
    });
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
});
