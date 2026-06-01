import { describe, expect, it } from "vitest";
import type { CodexInspectableItem, CodexThreadViewModel } from "../domain/codex";
import { buildThreadScrollSignal, distanceFromThreadBottom, shouldFollowThreadScroll } from "../features/thread/threadAutoScroll";

function item(overrides: Partial<CodexInspectableItem>): CodexInspectableItem {
  return {
    id: "item-1",
    kind: "assistant",
    title: "Assistant",
    text: "Hello",
    status: "running",
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: "2026-05-31T00:00:00.000Z",
    timestamp: "00:00",
    tone: "neutral",
    ...overrides,
  };
}

function model(overrides: Partial<CodexThreadViewModel>): CodexThreadViewModel {
  return {
    status: "ready",
    thread: null,
    activeTurn: null,
    messages: [],
    planDrafts: [],
    pendingActions: [],
    running: false,
    failed: false,
    interrupted: false,
    itemCount: 0,
    ...overrides,
  };
}

describe("thread auto-scroll helpers", () => {
  it("tracks distance from bottom and only follows when close enough", () => {
    expect(distanceFromThreadBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 200 })).toBe(100);
    expect(shouldFollowThreadScroll({ scrollHeight: 1000, scrollTop: 700, clientHeight: 200 })).toBe(true);
    expect(shouldFollowThreadScroll({ scrollHeight: 1000, scrollTop: 500, clientHeight: 200 })).toBe(false);
  });

  it("changes signal when any streamed message grows, not only the last item", () => {
    const before = buildThreadScrollSignal(model({
      itemCount: 2,
      running: true,
      messages: [
        item({ id: "reasoning", kind: "reasoning", text: "Inspect" }),
        item({ id: "assistant", kind: "assistant", text: "" }),
      ],
    }));
    const after = buildThreadScrollSignal(model({
      itemCount: 2,
      running: true,
      messages: [
        item({ id: "reasoning", kind: "reasoning", text: "Inspecting more context" }),
        item({ id: "assistant", kind: "assistant", text: "" }),
      ],
    }));

    expect(after).not.toBe(before);
  });

  it("changes signal for pending actions, plan drafts, and errors", () => {
    const base = buildThreadScrollSignal(model({ itemCount: 1 }));
    const pending = buildThreadScrollSignal(model({
      itemCount: 1,
      pendingActions: [item({ id: "approval", kind: "approval", status: "pending" })],
    }));
    const draft = buildThreadScrollSignal(model({
      itemCount: 1,
      planDrafts: [item({ id: "draft", kind: "planDraft", text: "Plan" })],
    }));
    const error = buildThreadScrollSignal(model({
      itemCount: 1,
      failed: true,
      error: "Codex failed",
    }));

    expect(new Set([base, pending, draft, error]).size).toBe(4);
  });
});
