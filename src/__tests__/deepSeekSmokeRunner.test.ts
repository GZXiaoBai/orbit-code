import { describe, expect, it, vi } from "vitest";
import { createActionRequiredEvent } from "../domain/actionRequired";
import type { ThreadEvent } from "../domain/threadEvents";
import { DeepSeekSmokeRunner } from "../runtime/deepSeekSmokeRunner";

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

describe("DeepSeekSmokeRunner", () => {
  it("runs the three real smoke paths and reports aggregate status", async () => {
    const adapter = {
      run: vi.fn(async () => ({
        events: [
          event({ id: "plan", kind: "planDraft", planDraft: {
            version: "1",
            title: "Plan",
            goals: [],
            constraints: [],
            tasks: [],
            acceptanceCriteria: [],
            risks: [],
            references: [],
          } }),
          event({ id: "switch", kind: "modeSwitch", modeSwitch: { from: "plan", to: "build" } }),
          event({ id: "question", kind: "question", question: { question: "Pick", status: "answered" } }),
          event({ id: "patch", kind: "patchProposal", patches: [{ path: "README.md", oldContent: "", newContent: "ok", applied: true }] }),
          event({ id: "checkpoint", kind: "checkpoint", checkpoint: { checkpointId: "c1", strategy: "file-snapshot", filePaths: ["README.md"], status: "created" } }),
          event({ id: "verification", kind: "verification", verification: { command: "npm", args: ["test"], status: "approved" } }),
          event({ id: "terminal", kind: "terminalRun", terminalRun: {
            id: "t1",
            taskId: "task-1",
            command: "npm",
            args: ["test"],
            reason: "verify",
            status: "done",
            exitCode: 0,
            output: "ok",
            startedAt: "2026-05-29T00:00:00.000Z",
          } }),
          event({ id: "final", kind: "finalSummary", title: "Final Summary", message: "Done" }),
        ],
        actionRequired: [createActionRequiredEvent({
          id: "approval",
          kind: "command",
          tool: "run_command",
          title: "Run command",
          description: "npm test",
          status: "approved",
        })],
      })),
    };

    const result = await new DeepSeekSmokeRunner(adapter).run({
      model: "deepseek-v4-flash",
    });

    expect(adapter.run).toHaveBeenCalledTimes(3);
    expect(result.result).toBe("verified");
    expect(result.records).toHaveLength(3);
  });

  it("does not mark fixture-backed runs verified", async () => {
    const adapter = { run: vi.fn() };
    const result = await new DeepSeekSmokeRunner(adapter).run({
      model: "fixture",
      providerId: "fixture",
      paths: ["happyPath"],
    });

    expect(adapter.run).not.toHaveBeenCalled();
    expect(result.result).toBe("broken");
    expect(result.records[0].failure?.stage).toBe("planDraft");
  });
});
