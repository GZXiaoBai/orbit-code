import { describe, expect, it, vi } from "vitest";
import { AgentTurnRunner, type AgentBuildEngineAdapter, type AgentTurnRunnerCallbacks } from "../state/agentTurnRunner";
import type { PlanTask } from "../domain/types";

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

function task(): PlanTask {
  return {
    id: "task-1",
    title: "Task",
    description: "Do it",
    status: "queued",
    dependsOn: [],
    filesHint: [],
    verification: [],
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

  it("returns a structured completed result for Build turns", async () => {
    const fakeEngine: AgentBuildEngineAdapter = {
      getStatus: vi.fn(() => ({ isRunning: false, phase: "idle" as const, currentTask: null, currentIteration: 0, toolCalls: [], messages: [] })),
      cancel: vi.fn(),
      runTask: vi.fn(async () => "done"),
    };
    const runner = new AgentTurnRunner(callbacks(), () => fakeEngine);

    const result = await runner.runBuildTurn({
      task: task(),
      provider: "deepseek" as any,
      model: "deepseek-v4-flash",
    });

    expect(result).toMatchObject({ kind: "completed", summary: "done" });
    expect(result).toMatchObject({ finalSummary: "done" });
    expect(runner.getTurnState()).toMatchObject({ mode: "build", status: "completed" });
  });

  it("can represent explicit waiting-action turns without React state", () => {
    const runner = new AgentTurnRunner(callbacks());

    const result = runner.markWaitingAction({
      actionId: "action-1",
      lastToolResult: "Approved command; explicit continue required.",
    });

    expect(result).toMatchObject({
      kind: "waitingAction",
      waitingActionId: "action-1",
      lastToolResult: "Approved command; explicit continue required.",
    });
    expect(runner.getTurnState()).toMatchObject({
      status: "waitingAction",
      waitingActionId: "action-1",
    });
  });

  it("resumes Build turns through the same structured runner contract", async () => {
    const fakeEngine: AgentBuildEngineAdapter = {
      getStatus: vi.fn(() => ({ isRunning: false, phase: "idle" as const, currentTask: null, currentIteration: 0, toolCalls: [], messages: [] })),
      cancel: vi.fn(),
      runTask: vi.fn(async () => "resumed"),
    };
    const runner = new AgentTurnRunner(callbacks(), () => fakeEngine);

    const result = await runner.resumeBuildTurn({
      task: task(),
      provider: "deepseek" as any,
      model: "deepseek-v4-flash",
      resumeContext: "User explicitly continued.",
    });

    expect(result).toMatchObject({ kind: "completed", summary: "resumed" });
    expect(fakeEngine.runTask).toHaveBeenCalledWith(
      expect.anything(),
      "deepseek",
      "deepseek-v4-flash",
      undefined,
      undefined,
      undefined,
      "User explicitly continued.",
    );
  });

  it("returns failed Build results instead of throwing into React callers", async () => {
    const fakeEngine: AgentBuildEngineAdapter = {
      getStatus: vi.fn(() => ({ isRunning: false, phase: "error" as const, currentTask: null, currentIteration: 0, toolCalls: [], messages: [] })),
      cancel: vi.fn(),
      runTask: vi.fn(async () => {
        throw new Error("model failed");
      }),
    };
    const runner = new AgentTurnRunner(callbacks(), () => fakeEngine);

    const result = await runner.runBuildTurn({
      task: task(),
      provider: "deepseek" as any,
      model: "deepseek-v4-flash",
    });

    expect(result).toMatchObject({ kind: "failed", error: "model failed" });
    expect(runner.getTurnState()).toMatchObject({ mode: "build", status: "failed" });
  });
});
