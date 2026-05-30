import { describe, expect, it } from "vitest";
import {
  appendRuntimeMessagePart,
  createRuntimeMessage,
  finishRuntimeMessage,
  restoreRuntimeMessages,
  runtimeMessagesToThreadEvents,
} from "../domain/runtimeMessages";

describe("RuntimeMessage protocol", () => {
  it("serializes and restores OpenCode-style message parts", () => {
    const message = finishRuntimeMessage(appendRuntimeMessagePart(createRuntimeMessage({
      id: "m1",
      threadId: "thread-1",
      role: "assistant",
      at: "2026-05-30T00:00:00.000Z",
    }), {
      type: "reasoning",
      text: "I should inspect the project first.",
    }, "2026-05-30T00:00:01.000Z"), "stop", "2026-05-30T00:00:02.000Z");

    const restored = restoreRuntimeMessages({ messages: [message] });

    expect(restored[0]).toMatchObject({
      id: "m1",
      threadId: "thread-1",
      role: "assistant",
      status: "completed",
    });
    expect(restored[0].parts).toEqual([
      { type: "reasoning", text: "I should inspect the project first." },
      { type: "finish", reason: "stop", at: "2026-05-30T00:00:02.000Z" },
    ]);
  });

  it("serializes Pi-style thinking and error parts", () => {
    const message = createRuntimeMessage({
      id: "m-pi",
      threadId: "thread-1",
      role: "assistant",
      parentId: "m-user",
      parts: [
        { type: "thinking", text: "Inspect session state.", collapsed: false },
        { type: "error", message: "Recoverable parser error", recoverable: true },
      ],
      at: "2026-05-30T00:00:00.000Z",
    });

    const restored = restoreRuntimeMessages({ messages: [message] });
    const events = runtimeMessagesToThreadEvents(restored);

    expect(restored[0].parentId).toBe("m-user");
    expect(events.map((event) => event.kind)).toEqual(["reasoningSummary", "error"]);
    expect(events[0]).toMatchObject({ status: "thinking", message: "Inspect session state." });
  });

  it("projects reasoning, text, and tool calls without exposing raw params", () => {
    const message = createRuntimeMessage({
      id: "m2",
      threadId: "thread-1",
      role: "assistant",
      status: "streaming",
      parts: [
        { type: "reasoning", text: "Reading files." },
        { type: "text", text: "I will inspect the repo." },
        {
          type: "toolCall",
          id: "tool-1",
          name: "run_command",
          argsSummary: "npm test",
          params: { command: "npm", args: ["test"] },
        },
      ],
      at: "2026-05-30T00:00:00.000Z",
    });

    const events = runtimeMessagesToThreadEvents([message]);

    expect(events.map((event) => event.kind)).toEqual(["reasoningSummary", "agentMessage", "toolCall"]);
    expect(events[2].toolCall).toMatchObject({
      id: "tool-1",
      name: "run_command",
      status: "pending",
    });
    expect(events[2].toolCall?.params).toBeUndefined();
  });
});
