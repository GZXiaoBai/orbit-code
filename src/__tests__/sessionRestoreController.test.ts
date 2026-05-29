import { describe, expect, it } from "vitest";
import { createActionRequiredEvent } from "../domain/actionRequired";
import { createTerminalRun } from "../domain/terminalRun";
import { SessionRestoreController } from "../state/sessionRestoreController";

describe("SessionRestoreController", () => {
  it("restores pending actions as explicit-continue resume results", () => {
    const controller = new SessionRestoreController();
    const action = createActionRequiredEvent({
      id: "approval-1",
      kind: "command",
      tool: "run_command",
      title: "Run command",
      description: "npm test",
    });

    const result = controller.restore({
      runtimeLedgerSnapshot: {
        threadEvents: [{
          id: "event-1",
          kind: "approval",
          role: "reviewer",
          status: "thinking",
          title: "Approval",
          message: "Waiting",
          timestamp: "2026-05-29T00:00:00.000Z",
        }],
        actionRequired: [action],
      },
    });

    expect(result.mode).toBe("pending-action");
    expect(result.pendingActions).toHaveLength(1);
    expect(result.resumeResults[0]).toMatchObject({
      explicitContinueRequired: true,
      resumeAction: { type: "approval", payloadId: "approval-1" },
    });
  });

  it("recovers restored running terminal runs as unknown-needs-continue", () => {
    const controller = new SessionRestoreController();
    const run = createTerminalRun({
      taskId: "task-1",
      command: "npm",
      args: ["run", "dev"],
      output: "server output",
      at: "2026-05-29T00:00:00.000Z",
    });

    const result = controller.restore({
      runtimeLedgerSnapshot: {
        terminalRuns: [run],
      },
    });

    expect(result.ledger.terminalRuns[0]).toMatchObject({
      status: "cancelled",
      recoveredState: "unknown-needs-continue",
    });
    expect(result.resumeResults[0]).toMatchObject({
      kind: "terminal",
      explicitContinueRequired: true,
    });
  });
});
