import { describe, expect, it } from "vitest";
import { createActionRequiredEvent } from "../domain/actionRequired";
import type { ThreadEvent } from "../domain/threadEvents";
import { runStepsFromActionRequired, runStepsFromEvents, selectRunSteps } from "../domain/runSteps";

describe("run steps view model", () => {
  it("maps ActionRequired command approvals to waiting command steps", () => {
    const action = createActionRequiredEvent({
      id: "action-command",
      kind: "command",
      tool: "run_command",
      title: "Run command",
      description: "npm test",
    });

    expect(runStepsFromActionRequired([action])[0]).toMatchObject({
      id: "action:action-command",
      kind: "approval",
      status: "waiting",
      approvalId: "action-command",
    });
  });

  it("maps patch events to patch steps", () => {
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

    expect(runStepsFromEvents([event])[0].kind).toBe("patch");
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
