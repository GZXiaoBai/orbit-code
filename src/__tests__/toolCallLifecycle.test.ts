import { describe, expect, it } from "vitest";
import {
  createToolCallLifecycle,
  toolCallLifecycleToolResult,
  updateToolCallLifecycle,
} from "../domain/toolCallLifecycle";

describe("ToolCallLifecycle", () => {
  it("records generated, policy, running, and terminal states", () => {
    const generated = createToolCallLifecycle({
      id: "tool-1",
      tool: "run_command",
      args: { command: "npm", args: ["test"] },
      createdAt: "2026-05-29T00:00:00.000Z",
    });
    const policy = updateToolCallLifecycle(generated, {
      status: "policyEvaluated",
      policyDecision: { decision: "ask", actions: ["command"], reason: "User confirmation required." },
    }, "2026-05-29T00:00:01.000Z");
    const running = updateToolCallLifecycle(policy, { status: "running" }, "2026-05-29T00:00:02.000Z");
    const completed = updateToolCallLifecycle(running, { status: "completed", resultText: "Tests passed." }, "2026-05-29T00:00:03.000Z");

    expect(generated.status).toBe("generated");
    expect(policy.policyDecision?.decision).toBe("ask");
    expect(completed.updatedAt).toBe("2026-05-29T00:00:03.000Z");
    expect(toolCallLifecycleToolResult(completed)).toBe("Tests passed.");
  });

  it("turns denied and cancelled calls into stable tool results", () => {
    expect(toolCallLifecycleToolResult(createToolCallLifecycle({
      id: "tool-1",
      tool: "run_command",
      status: "denied",
      error: "blocked",
    }))).toBe("Denied run_command: blocked");

    expect(toolCallLifecycleToolResult(createToolCallLifecycle({
      id: "tool-2",
      tool: "run_command",
      status: "cancelled",
    }))).toBe("Cancelled run_command.");
  });
});
