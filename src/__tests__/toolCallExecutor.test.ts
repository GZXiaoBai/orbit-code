import { describe, expect, it, vi } from "vitest";
import { ToolCallExecutor } from "../state/toolCallExecutor";
import type { ToolCallLifecycle } from "../domain/toolCallLifecycle";
import { PermissionScheduler } from "../runtime/permissionScheduler";

describe("ToolCallExecutor", () => {
  it("writes generated and completed lifecycle records through the ledger-facing store", () => {
    const calls: ToolCallLifecycle[] = [];
    const store = {
      list: () => calls,
      append: vi.fn((call: ToolCallLifecycle) => calls.push(call)),
      update: vi.fn((id: string, update: Partial<ToolCallLifecycle>) => {
        const index = calls.findIndex((call) => call.id === id);
        calls[index] = { ...calls[index], ...update };
      }),
    };
    const executor = new ToolCallExecutor(store);

    executor.recordGenerated({
      id: "tool-1",
      name: "run_command",
      params: { command: "npm", args: ["test"] },
      status: "pending",
    }, "npm test");
    executor.recordResult("tool-1", "Tests passed.");

    expect(store.append).toHaveBeenCalledTimes(1);
    expect(store.update).toHaveBeenLastCalledWith("tool-1", {
      status: "completed",
      resultText: "Tests passed.",
    });
    expect(calls[0]).toMatchObject({ id: "tool-1", tool: "run_command" });
  });

  it("links approval results back to the lifecycle record", () => {
    const update = vi.fn();
    const executor = new ToolCallExecutor({
      list: () => [],
      append: vi.fn(),
      update,
    });

    executor.recordApprovalResult({
      toolCallId: "tool-1",
      approval: {
        approved: false,
        action: { id: "action-1" } as any,
        resolution: { status: "denied", toolResultText: "Denied run_command" },
        policy: { decision: "ask", actions: ["command"], reason: "ask" },
        toolResult: "Denied run_command",
      },
    });

    expect(update).toHaveBeenCalledWith("tool-1", expect.objectContaining({
      status: "denied",
      actionRequiredId: "action-1",
      resultText: "Denied run_command",
    }));
  });

  it("routes runtime approval requests through the executor lifecycle", async () => {
    const calls: ToolCallLifecycle[] = [];
    const update = vi.fn((id: string, patch: Partial<ToolCallLifecycle>) => {
      const index = calls.findIndex((call) => call.id === id);
      calls[index] = { ...calls[index], ...patch };
    });
    const executor = new ToolCallExecutor({
      list: () => calls,
      append: vi.fn((call: ToolCallLifecycle) => calls.push(call)),
      update,
    });

    const result = await executor.requestApproval({
      toolCall: {
        id: "tool-approval",
        name: "run_command",
        params: { command: "npm", args: ["test"] },
        status: "pending",
      },
      params: { command: "npm", args: ["test"] },
      requestApproval: vi.fn(async () => ({
        approved: true,
        action: { id: "action-approval" } as any,
        resolution: { status: "approved" as const, toolResultText: "Approved run_command" },
        policy: { decision: "ask" as const, actions: ["command"] as any, reason: "ask" },
        toolResult: "Approved run_command",
      })),
    });

    expect(result).toMatchObject({
      approved: true,
      actionRequiredId: "action-approval",
      status: "actionRequired",
    });
    expect(calls[0]).toMatchObject({
      id: "tool-approval",
      tool: "run_command",
      actionRequiredId: "action-approval",
      resultText: "Approved run_command",
    });
  });

  it("executes permission scheduling and records policy/action lifecycle through the store", async () => {
    const calls: ToolCallLifecycle[] = [];
    const update = vi.fn((id: string, patch: Partial<ToolCallLifecycle>) => {
      const index = calls.findIndex((call) => call.id === id);
      calls[index] = { ...calls[index], ...patch };
    });
    const scheduler = new PermissionScheduler({
      requestAction: vi.fn(async (action) => ({
        status: "denied" as const,
        toolResultText: `Denied run_command: ${action.description}`,
        resumeAction: action.resumeAction,
      })),
    });
    const executor = new ToolCallExecutor({
      list: () => calls,
      append: vi.fn((call: ToolCallLifecycle) => calls.push(call)),
      update,
    });

    const result = await executor.execute({
      id: "tool-2",
      name: "run_command",
      params: { command: "npm", args: ["install"] },
      status: "pending",
    }, {
      permissionScheduler: scheduler,
      mode: "build",
      toolCallId: "tool-2",
    });

    expect(result).toMatchObject({
      approved: false,
      status: "denied",
      toolResult: expect.stringContaining("Denied run_command"),
      actionRequiredId: expect.stringMatching(/^action-/),
    });
    expect(update).toHaveBeenCalledWith("tool-2", expect.objectContaining({
      status: "actionRequired",
      actionRequiredId: expect.stringMatching(/^action-/),
    }));
    expect(update).toHaveBeenLastCalledWith("tool-2", expect.objectContaining({
      status: "denied",
      resultText: expect.stringContaining("Denied run_command"),
    }));
  });
});
