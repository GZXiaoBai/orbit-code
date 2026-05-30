import { describe, expect, it } from "vitest";
import type { ToolCallLifecycle } from "../domain/toolCallLifecycle";
import { PiToolExecutor } from "../state/piToolExecutor";

function lifecycleStore() {
  let calls: ToolCallLifecycle[] = [];
  return {
    list: () => calls,
    append: (call: ToolCallLifecycle) => { calls = [call, ...calls]; },
    update: (id: string, update: Partial<ToolCallLifecycle> | ((call: ToolCallLifecycle) => ToolCallLifecycle)) => {
      calls = calls.map((call) => {
        if (call.id !== id) return call;
        return typeof update === "function" ? update(call) : { ...call, ...update };
      });
    },
  };
}

describe("PiToolExecutor", () => {
  it("denies Build-only tools in Plan mode with a stable tool result", async () => {
    const store = lifecycleStore();
    const executor = new PiToolExecutor(store);

    const result = await executor.execute({
      id: "tool-1",
      name: "run_command",
      params: { command: "npm", args: ["test"] },
      status: "pending",
    }, {
      mode: "plan",
      workspacePath: "/repo",
    });

    expect(result).toMatchObject({
      approved: false,
      status: "denied",
      toolResult: "Tool denied by plan mode: run_command",
    });
    expect(store.list()[0]).toMatchObject({
      id: "tool-1",
      status: "denied",
      resultText: "Tool denied by plan mode: run_command",
    });
  });

  it("executes done_plan through the approved-tool seam", async () => {
    const store = lifecycleStore();
    const executor = new PiToolExecutor(store);

    const result = await executor.execute({
      id: "tool-2",
      name: "done_plan",
      params: { summary: "Plan ready" },
      status: "pending",
    }, {
      mode: "plan",
      workspacePath: "/repo",
    });

    expect(result).toMatchObject({
      approved: true,
      status: "completed",
      toolResult: "Plan completed: Plan ready",
    });
    expect(store.list()[0]).toMatchObject({ id: "tool-2", status: "completed" });
  });
});
