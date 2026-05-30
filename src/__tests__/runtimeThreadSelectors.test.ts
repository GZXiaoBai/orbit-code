import { describe, expect, it } from "vitest";
import { createActionRequiredEvent } from "../domain/actionRequired";
import { createRuntimeMessage, finishRuntimeMessage } from "../domain/runtimeMessages";
import { selectRuntimeThread } from "../domain/runtimeThreadSelectors";

describe("runtime thread selectors", () => {
  it("collapses thinking after an assistant finish and hides it by preference", () => {
    const assistant = finishRuntimeMessage(createRuntimeMessage({
      id: "m1",
      threadId: "t1",
      role: "assistant",
      parts: [
        { type: "thinking", text: "Inspecting project." },
        { type: "text", text: "Plan complete." },
      ],
    }));

    const expanded = selectRuntimeThread([assistant], [], [], "expanded");
    expect(expanded.messages[0].parts[0]).toMatchObject({ type: "thinking", collapsed: true });
    expect(expanded.finishState).toBe("completed");

    const hidden = selectRuntimeThread([assistant], [], [], "hidden");
    expect(hidden.messages[0].parts.map((part) => part.type)).toEqual(["text", "finish"]);
  });

  it("projects pending actions and safe tool summaries without raw params", () => {
    const action = createActionRequiredEvent({
      id: "action-1",
      kind: "command",
      title: "Run command",
      description: "npm test",
    });
    const view = selectRuntimeThread([], [action], [{
      id: "tool-1",
      tool: "run_command",
      argsSummary: "npm test",
      status: "actionRequired",
      createdAt: "2026-05-30T00:00:00.000Z",
      updatedAt: "2026-05-30T00:00:00.000Z",
    }]);

    expect(view.pendingActions).toHaveLength(1);
    expect(view.safeToolSummaries).toEqual([{ id: "tool-1", name: "run_command", summary: "npm test", status: "actionRequired" }]);
    expect(JSON.stringify(view)).not.toContain("params");
  });
});
