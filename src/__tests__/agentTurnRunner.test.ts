import { describe, expect, it, vi } from "vitest";
import { AgentTurnRunner, type AgentTurnRunnerCallbacks } from "../state/agentTurnRunner";

function callbacks(): AgentTurnRunnerCallbacks {
  return {
    onPhaseChange: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onRequestApproval: vi.fn(async () => false),
    onError: vi.fn(),
    onDone: vi.fn(),
    shouldCancel: () => false,
    getWorkspacePath: () => "/tmp/project",
  };
}

describe("AgentTurnRunner", () => {
  it("tracks Plan turn lifecycle without React state", async () => {
    const runner = new AgentTurnRunner(callbacks());

    const result = await runner.runPlanTurn({
      prompt: "plan this",
      planner: async (prompt) => ({ kind: "planDraft", summary: prompt }),
    });

    expect(result).toEqual({ kind: "planDraft", summary: "plan this" });
    expect(runner.getTurnState()).toMatchObject({
      mode: "plan",
      status: "completed",
    });
  });

  it("records failed turn state for planner errors", async () => {
    const runner = new AgentTurnRunner(callbacks());

    await expect(runner.runPlanTurn({
      prompt: "plan",
      planner: async () => {
        throw new Error("planner failed");
      },
    })).rejects.toThrow("planner failed");

    expect(runner.getTurnState()).toMatchObject({
      mode: "plan",
      status: "failed",
      error: "planner failed",
    });
  });
});
