import { describe, expect, it } from "vitest";
import { ActionBus } from "../state/actionBus";

describe("ActionBus", () => {
  it("publishes a durable action and resolves it as a tool result", async () => {
    const bus = new ActionBus();
    const pending = bus.request({
      id: "action-1",
      kind: "command",
      title: "Run command",
      description: "npm test",
      tool: "run_command",
    });

    expect(bus.snapshot().actions[0]).toMatchObject({
      id: "action-1",
      status: "pending",
      resumeAction: { type: "approval", payloadId: "action-1" },
    });

    const resolved = bus.resolve("action-1", { approved: false, reason: "Not now" });
    await expect(pending).resolves.toMatchObject({
      status: "denied",
      toolResultText: "Denied run_command: Not now",
    });
    expect(resolved).toMatchObject({
      status: "denied",
      toolResultText: "Denied run_command: Not now",
    });
  });

  it("replays pending actions with resume metadata", () => {
    const bus = new ActionBus({
      actions: [{
        id: "question-1",
        kind: "question",
        title: "Question",
        description: "Choose",
        question: "Choose",
        status: "pending",
        createdAt: "2026-05-30T00:00:00.000Z",
      }],
    });

    expect(bus.replayPending()).toEqual([expect.objectContaining({
      id: "question-1",
      resumeAction: { type: "question", payloadId: "question-1" },
    })]);
  });
});
