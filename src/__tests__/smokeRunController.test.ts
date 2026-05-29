import { describe, expect, it, vi } from "vitest";
import { createActionRequiredEvent } from "../domain/actionRequired";
import type { ThreadEvent } from "../domain/threadEvents";
import { SmokeRunController } from "../runtime/smokeRunController";

function event(overrides: Partial<ThreadEvent>): ThreadEvent {
  return {
    id: overrides.id || "event-1",
    kind: overrides.kind || "agentMessage",
    role: overrides.role || "planner",
    status: overrides.status || "done",
    title: overrides.title || "Event",
    message: overrides.message || "Message",
    timestamp: "12:00:00",
    ...overrides,
  };
}

describe("SmokeRunController", () => {
  it("does not execute or pass fixture smoke runs", async () => {
    const adapter = { run: vi.fn() };
    const controller = new SmokeRunController(adapter);

    const record = await controller.run({
      model: "fixture",
      providerId: "fixture",
    });

    expect(adapter.run).not.toHaveBeenCalled();
    expect(record.result).toBe("failed");
    expect(record.missingStages).toContain("planDraft");
  });

  it("runs the adapter and records typed-stage failures", async () => {
    const controller = new SmokeRunController({
      run: vi.fn(async () => ({
        threadId: "thread-1",
        runSessionId: "run-1",
        events: [event({ id: "plan", kind: "planDraft", planDraft: {
          version: "1",
          title: "Plan",
          goals: [],
          constraints: [],
          tasks: [],
          acceptanceCriteria: [],
          risks: [],
          references: [],
        } })],
        actionRequired: [createActionRequiredEvent({
          id: "approval-1",
          kind: "command",
          tool: "run_command",
          title: "Run command",
          description: "npm test",
        })],
      })),
    });

    const record = await controller.run({ model: "deepseek-v4-flash" });

    expect(record.threadId).toBe("thread-1");
    expect(record.result).toBe("failed");
    expect(record.failure?.stage).toBe("modeSwitch");
    expect(record.pendingActionIds).toEqual(["approval-1"]);
  });
});
