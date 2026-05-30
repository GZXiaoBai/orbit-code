import { describe, expect, it, vi } from "vitest";
import { AgentKernel } from "../state/agentKernel";
import type { ToolLoopCallbacks } from "../state/toolLoopController";
import type { PlanTask } from "../domain/types";

function callbacks(): ToolLoopCallbacks {
  return {
    onPhaseChange: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onRequestApproval: vi.fn(async () => false),
    onError: vi.fn(),
    onDone: vi.fn(),
    shouldCancel: () => false,
    getWorkspacePath: () => "/repo",
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

describe("AgentKernel", () => {
  it("runs Plan turns through a non-React kernel interface", async () => {
    const kernel = new AgentKernel(callbacks());

    const result = await kernel.runPlanTurn({
      prompt: "plan",
      planner: async (prompt) => ({ kind: "planDraft", summary: prompt }),
    });

    expect(result).toEqual({ kind: "planDraft", summary: "plan" });
    expect(kernel.getState()).toMatchObject({
      running: false,
      lastResult: { kind: "planDraft", summary: "plan" },
    });
  });

  it("cancels through the kernel without exposing React state", () => {
    const kernel = new AgentKernel(callbacks());

    kernel.cancel();

    expect(kernel.getState()).toMatchObject({ running: false });
  });

  it("returns structured Build correction failures through the kernel", async () => {
    const cb = callbacks();
    cb.getMaxIterations = () => 0;
    const kernel = new AgentKernel(cb);

    const result = await kernel.runBuildTurn({
      task: task(),
      provider: "deepseek" as any,
      model: "deepseek-v4-flash",
    });

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error(`Unexpected result: ${result.kind}`);
    expect(result.summary).toContain("valid strict JSON tool call");
  });
});
