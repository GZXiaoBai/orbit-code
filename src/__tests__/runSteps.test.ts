import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "../domain/threadEvents";
import { mergeRunSteps, runStepsFromApprovals, runStepsFromEvents, selectRunSteps } from "../domain/runSteps";
import { createApprovalRequest, resolveApprovalRequest } from "../state/useApprovalQueue";

describe("run steps view model", () => {
  it("maps pending command approvals to waiting command steps", () => {
    const request = createApprovalRequest("run_command", { command: "npm", args: ["test"] }, "verify");
    const steps = runStepsFromApprovals([request]);

    expect(steps[0]).toMatchObject({
      kind: "command",
      status: "waiting",
      title: "run_command",
      approvalId: request.id,
    });
  });

  it("maps denied approvals to denied steps", () => {
    const request = createApprovalRequest("run_command", { command: "npm" }, "verify");
    const denied = resolveApprovalRequest([request], request.id, false);

    expect(runStepsFromApprovals(denied)[0].status).toBe("denied");
  });

  it("maps patch events to patch steps and preserves ordering with approvals", () => {
    const event: ThreadEvent = {
      id: "patch-1",
      kind: "patchProposal",
      role: "coder",
      title: "Patch Proposal",
      status: "done",
      message: "Agent proposed a patch",
      timestamp: "12:00",
      patches: [{ path: "src/App.tsx", oldContent: "old", newContent: "new", applied: false }],
    };
    const request = createApprovalRequest("run_command", { command: "npm" }, "verify");

    expect(runStepsFromEvents([event])[0].kind).toBe("patch");
    expect(mergeRunSteps([event], [request]).map((step) => step.kind)).toEqual(["patch", "command"]);
  });

  it("projects run steps from ledger tool lifecycle instead of legacy approval queues", () => {
    const steps = selectRunSteps({
      threadEvents: [],
      actionRequired: [],
      toolCalls: [{
        id: "tool-1",
        tool: "run_command",
        status: "denied",
        error: "blocked by policy",
        createdAt: "2026-05-29T00:00:00.000Z",
      }],
      terminalRuns: [],
      checkpoints: [],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: "tool:tool-1",
        kind: "command",
        status: "denied",
        detail: "blocked by policy",
      }),
    ]);
  });
});
