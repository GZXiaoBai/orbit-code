import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../domain/agentEvents";
import { mergeRunSteps, runStepsFromApprovals, runStepsFromEvents } from "../domain/runSteps";
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
    const event: AgentEvent = {
      id: "patch-1",
      role: "coder",
      name: "Patch Proposal",
      status: "done",
      message: "Agent proposed a patch",
      timestamp: "12:00",
      patches: [{ path: "src/App.tsx", oldContent: "old", newContent: "new", applied: false }],
    };
    const request = createApprovalRequest("run_command", { command: "npm" }, "verify");

    expect(runStepsFromEvents([event])[0].kind).toBe("patch");
    expect(mergeRunSteps([event], [request]).map((step) => step.kind)).toEqual(["patch", "command"]);
  });
});
