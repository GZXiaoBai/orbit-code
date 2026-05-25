import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../domain/agentEvents";
import { createQuestionRequest } from "../domain/questionRequest";
import { createTerminalRun } from "../domain/terminalRun";
import { createApprovalRequest } from "../state/useApprovalQueue";
import { buildReviewDockModel } from "../features/review/reviewDockModel";

describe("review dock queue model", () => {
  it("groups command, question, patch, verification, and terminal queues", () => {
    const command = createApprovalRequest("run_command", { command: "npm", args: ["test"] });
    const verification = createApprovalRequest("run_command", {
      command: "npm",
      args: ["run", "build"],
      sourceEventId: "patch-1",
    });
    const question = createQuestionRequest({ taskId: "task-1", question: "Which target?" });
    const patchEvent: AgentEvent = {
      id: "patch-1",
      role: "coder",
      name: "Patch Proposal",
      status: "done",
      message: "patch",
      timestamp: "12:00",
      patches: [{ path: "a.ts", oldContent: "a", newContent: "b", applied: false }],
    };
    const appliedPatchEvent: AgentEvent = {
      ...patchEvent,
      id: "patch-2",
      patches: [{ path: "done.ts", oldContent: "a", newContent: "b", applied: true }],
    };
    const terminal = createTerminalRun({ taskId: "task-1", command: "npm", args: ["test"], status: "done", exitCode: 0 });

    const model = buildReviewDockModel({
      approvals: [command, verification],
      questions: [question],
      events: [patchEvent, appliedPatchEvent],
      terminalRuns: [terminal],
    });

    expect(model.commandApprovals).toHaveLength(1);
    expect(model.verificationApprovals).toHaveLength(1);
    expect(model.questions).toHaveLength(1);
    expect(model.patchReviews).toHaveLength(1);
    expect(model.appliedPatchReviews).toHaveLength(1);
    expect(model.terminalRuns).toHaveLength(1);
    expect(model.counts.changes).toBe(4);
  });
});
