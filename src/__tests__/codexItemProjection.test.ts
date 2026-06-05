import { describe, expect, it } from "vitest";
import type { CodexItem } from "../domain/codex";
import { applyCodexItemEvent } from "../runtime/codexItemEvents";
import { buildCodexProjection } from "../runtime/codexItemProjection";

function item(overrides: Partial<CodexItem> = {}): CodexItem {
  return {
    id: "codex-item-1",
    threadId: "thread-1",
    turnId: "turn-1",
    kind: "assistant",
    title: "Codex message",
    text: "Codex completed the turn.",
    status: "completed",
    createdAt: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("Codex item projection", () => {
  it("merges Codex item delta events without replaying duplicate sequences", () => {
    const running = applyCodexItemEvent([], {
      type: "upsert",
      item: item({ id: "assistant-live", text: "", status: "running" }),
    });
    const withDelta = applyCodexItemEvent(running, {
      type: "delta",
      itemId: "assistant-live",
      threadId: "thread-1",
      turnId: "turn-1",
      kind: "assistant",
      textDelta: "Hel",
      sequence: 1,
    });
    const duplicate = applyCodexItemEvent(withDelta, {
      type: "delta",
      itemId: "assistant-live",
      textDelta: "Hel",
      sequence: 1,
    });
    const complete = applyCodexItemEvent(duplicate, {
      type: "complete",
      itemId: "assistant-live",
      status: "completed",
    });

    expect(complete[0]).toMatchObject({ id: "assistant-live", text: "Hel", status: "completed" });
  });

  it("drops late duplicate deltas after a newer sequence has already arrived", () => {
    const running = applyCodexItemEvent([], {
      type: "upsert",
      item: item({ id: "assistant-live", text: "", status: "running" }),
    });
    const first = applyCodexItemEvent(running, {
      type: "delta",
      itemId: "assistant-live",
      threadId: "thread-1",
      turnId: "turn-1",
      kind: "assistant",
      textDelta: "你",
      sequence: 1,
    });
    const second = applyCodexItemEvent(first, {
      type: "delta",
      itemId: "assistant-live",
      threadId: "thread-1",
      turnId: "turn-1",
      kind: "assistant",
      textDelta: "好",
      sequence: 2,
    });
    const lateDuplicate = applyCodexItemEvent(second, {
      type: "delta",
      itemId: "assistant-live",
      threadId: "thread-1",
      turnId: "turn-1",
      kind: "assistant",
      textDelta: "你",
      sequence: 1,
    });

    expect(lateDuplicate[0]).toMatchObject({ id: "assistant-live", text: "你好", status: "running" });
  });

  it("does not clear streamed text when app-server completes an item with an empty body", () => {
    const withDelta = applyCodexItemEvent([item({ id: "assistant-live", text: "Hello", status: "running" })], {
      type: "complete",
      item: item({ id: "assistant-live", text: "", status: "completed" }),
    });

    expect(withDelta[0]).toMatchObject({ id: "assistant-live", text: "Hello", status: "completed" });
  });

  it("keeps completed item metadata while preserving already streamed text", () => {
    const withDelta = applyCodexItemEvent([item({
      id: "assistant-live",
      title: "Assistant",
      text: "Hello",
      status: "running",
      metadata: { providerId: "deepseek" },
    })], {
      type: "complete",
      item: item({
        id: "assistant-live",
        title: "DeepSeek final",
        text: "",
        status: "completed",
        metadata: { usage: { total_tokens: 12 } },
      }),
    });

    expect(withDelta[0]).toMatchObject({
      id: "assistant-live",
      title: "DeepSeek final",
      text: "Hello",
      status: "completed",
      metadata: {
        providerId: "deepseek",
        usage: { total_tokens: 12 },
      },
    });
  });

  it("does not let stale shorter upserts truncate already streamed text", () => {
    const running = applyCodexItemEvent([item({
      id: "assistant-live",
      text: "Hello world",
      status: "running",
    })], item({
      id: "assistant-live",
      text: "Hello",
      status: "running",
    }));

    expect(running[0]).toMatchObject({
      id: "assistant-live",
      text: "Hello world",
      status: "running",
    });
  });

  it("does not let stale shorter complete events truncate already streamed text", () => {
    const complete = applyCodexItemEvent([item({
      id: "assistant-live",
      text: "Hello world",
      status: "running",
    })], {
      type: "complete",
      item: item({
        id: "assistant-live",
        text: "Hello",
        status: "completed",
      }),
    });

    expect(complete[0]).toMatchObject({
      id: "assistant-live",
      text: "Hello world",
      status: "completed",
    });
  });

  it("marks failed streaming items without dropping their existing text", () => {
    const failed = applyCodexItemEvent([item({ id: "assistant-live", text: "Partial answer", status: "running" })], {
      type: "fail",
      itemId: "assistant-live",
      error: "DeepSeek stream failed",
    });

    expect(failed[0]).toMatchObject({
      id: "assistant-live",
      text: "Partial answer",
      status: "failed",
      metadata: { error: "DeepSeek stream failed" },
    });
  });

  it("updates retry warnings in place instead of appending repeated reconnect items", () => {
    const first = applyCodexItemEvent([], {
      type: "upsert",
      item: item({ id: "retry-turn-1", kind: "reasoning", title: "Codex app-server retry", text: "Reconnecting... 1/5", status: "running" }),
    });
    const second = applyCodexItemEvent(first, {
      type: "upsert",
      item: item({ id: "retry-turn-1", kind: "reasoning", title: "Codex app-server retry", text: "Reconnecting... 2/5", status: "running" }),
    });

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ id: "retry-turn-1", text: "Reconnecting... 2/5" });
  });

  it("maps Codex thread items into timeline and runtime message projections", () => {
    const projection = buildCodexProjection({
      status: "ready",
      thread: null,
      activeTurn: null,
      items: [
        item({ id: "reasoning", kind: "reasoning", title: "Reasoning", text: "Inspecting workspace." }),
        item({ id: "assistant", kind: "assistant", title: "Summary", text: "Done." }),
      ],
    });

    expect(projection.events.map((event) => event.kind)).toEqual(["reasoningSummary", "agentMessage"]);
    expect(projection.runtimeMessages).toHaveLength(2);
    expect(projection.threadModel.messages.map((message) => message.kind)).toEqual(["reasoning", "assistant"]);
    expect(projection.threadModel.pendingActions).toHaveLength(0);
    expect(JSON.stringify(projection.runtimeMessages)).not.toContain('"tool":"');
  });

  it("does not show a stale running turn as active when no operation is running", () => {
    const projection = buildCodexProjection({
      status: "ready",
      thread: null,
      activeTurn: {
        id: "stale-turn",
        threadId: "thread-1",
        mode: "build",
        status: "running",
        startedAt: "2026-06-01T00:00:00.000Z",
      },
      activeOperation: {
        id: "op-build",
        kind: "build",
        status: "failed",
        startedAt: "2026-06-01T00:00:00.000Z",
        deadlineAt: "2026-06-01T00:00:25.000Z",
        finalState: "failed",
      },
      items: [item({ id: "error", kind: "error", title: "Build blocked", text: "Runtime unavailable", status: "failed" })],
    });

    expect(projection.threadModel.running).toBe(false);
    expect(projection.threadModel.failed).toBe(true);
  });

  it("does not show Settings restart as a thread turn running state", () => {
    const projection = buildCodexProjection({
      status: "starting",
      thread: null,
      activeTurn: null,
      activeOperation: {
        id: "op-restart",
        kind: "restart",
        status: "running",
        startedAt: "2026-06-01T00:00:00.000Z",
        deadlineAt: "2026-06-01T00:00:25.000Z",
      },
      items: [],
    });

    expect(projection.threadModel.running).toBe(false);
  });

  it("maps Codex approval and terminal items into action and run-step models", () => {
    const projection = buildCodexProjection({
      status: "running",
      thread: null,
      activeTurn: null,
      items: [
        item({ id: "approval", kind: "approval", title: "Approve command", text: "Run npm test", status: "pending" }),
        item({ id: "terminal", kind: "terminal", title: "npm test", text: "ok", status: "completed", metadata: { command: "npm", args: ["test"], exitCode: 0 } }),
      ],
    });

    expect(projection.actions[0]).toMatchObject({ id: "approval", status: "pending" });
    expect(projection.terminalRuns[0]).toMatchObject({ command: "npm", exitCode: 0 });
    expect(projection.runSteps.map((step) => step.kind)).toEqual(["approval", "terminal"]);
    expect(projection.threadModel.pendingActions[0]).toMatchObject({ id: "approval", kind: "approval" });
    expect(projection.inspectorModel.actions[0]).toMatchObject({ id: "approval", status: "pending" });
    expect(projection.inspectorModel.terminals[0]).toMatchObject({ id: "terminal", kind: "terminal" });
  });

  it("builds Codex inspector sections for denied approvals, answered questions, edits, and usage", () => {
    const projection = buildCodexProjection({
      status: "ready",
      thread: null,
      activeTurn: null,
      items: [
        item({ id: "denied", kind: "approval", title: "Run rm", text: "Dangerous command", status: "denied" }),
        item({ id: "question", kind: "question", title: "Choose path", text: "Which path?", status: "completed", metadata: { answer: "safe" } }),
        item({
          id: "edit",
          kind: "fileEdit",
          title: "Patch",
          text: "Update README",
          metadata: {
            patches: [{
              path: "README.md",
              oldContent: "old",
              newContent: "new",
              sandboxStatus: "sandboxed",
              applyStatus: "pending",
            }],
          },
        }),
        item({ id: "usage", kind: "usage", title: "Usage", text: "tokens", metadata: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }),
      ],
    });

    expect(projection.inspectorModel.approvals[0]).toMatchObject({ id: "denied", tone: "danger" });
    expect(projection.inspectorModel.questions[0]).toMatchObject({ id: "question", status: "completed" });
    expect(projection.inspectorModel.edits[0]).toMatchObject({ id: "edit" });
    expect(projection.inspectorModel.patchEvents[0]?.patches?.[0]).toMatchObject({ path: "README.md" });
    expect(projection.inspectorModel.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(projection.inspectorModel.counts).toMatchObject({ actions: 2, pendingActions: 0, edits: 1, changes: 1 });
  });

  it("aggregates nested direct Plan usage metadata across providers", () => {
    const projection = buildCodexProjection({
      status: "ready",
      thread: null,
      activeTurn: null,
      items: [
        item({
          id: "deepseek-usage",
          kind: "usage",
          title: "Token usage",
          text: "DeepSeek usage",
          metadata: { providerId: "deepseek", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        }),
        item({
          id: "anthropic-usage",
          kind: "usage",
          title: "Token usage",
          text: "Anthropic usage",
          metadata: { providerId: "anthropic", usage: { input_tokens: 20, output_tokens: 8 } },
        }),
        item({
          id: "google-usage",
          kind: "usage",
          title: "Token usage",
          text: "Gemini usage",
          metadata: { providerId: "google", usage: { promptTokenCount: 30, candidatesTokenCount: 12, totalTokenCount: 42 } },
        }),
        item({
          id: "ollama-usage",
          kind: "usage",
          title: "Token usage",
          text: "Ollama usage",
          metadata: { providerId: "ollama", usage: { prompt_eval_count: 7, eval_count: 3 } },
        }),
      ],
    });

    expect(projection.inspectorModel.usage).toEqual({
      inputTokens: 67,
      outputTokens: 28,
      totalTokens: 95,
    });
  });

  it("reads nested app-server total token usage metadata", () => {
    const projection = buildCodexProjection({
      status: "ready",
      thread: null,
      activeTurn: null,
      items: [
        item({
          id: "app-server-usage",
          kind: "usage",
          title: "Token usage",
          text: "Codex app-server usage",
          metadata: {
            info: {
              last_token_usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
              total_token_usage: { input_tokens: 40, output_tokens: 11, total_tokens: 51 },
            },
          },
        }),
      ],
    });

    expect(projection.inspectorModel.usage).toEqual({
      inputTokens: 40,
      outputTokens: 11,
      totalTokens: 51,
    });
  });
});
