import { describe, expect, it } from "vitest";
import { ResumeController } from "../state/resumeController";

describe("ResumeController", () => {
  it("always requires explicit continue for restored actions", () => {
    const controller = new ResumeController();

    expect(controller.resume({
      kind: "approval",
      resumeAction: { type: "approval", payloadId: "approval-1" },
      toolResultText: "Approved run_command",
      message: "Continue required.",
    })).toMatchObject({
      explicitContinueRequired: true,
      resumeAction: { type: "approval", payloadId: "approval-1" },
    });
  });

  it("maps unknown recovered terminal state to explicit continue", () => {
    const controller = new ResumeController();

    expect(controller.terminalRecovery({
      id: "terminal-1",
      taskId: "task-1",
      command: "npm",
      args: ["test"],
      reason: "verify",
      status: "cancelled",
      exitCode: null,
      output: "tail",
      outputTail: "tail",
      startedAt: "2026-05-29T00:00:00.000Z",
      recoveredState: "unknown-needs-continue",
    })).toMatchObject({
      kind: "terminal",
      explicitContinueRequired: true,
      toolResultText: "tail",
    });
  });
});
