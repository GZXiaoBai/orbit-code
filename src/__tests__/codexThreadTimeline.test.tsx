import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodexThreadTimeline } from "../components/thread/CodexThreadTimeline";
import type { CodexThreadViewModel, CodexInspectableItem } from "../domain/codex";
import { copy } from "../i18n/copy";

function item(input: Partial<CodexInspectableItem> & Pick<CodexInspectableItem, "id" | "kind" | "text">): CodexInspectableItem {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title || input.kind,
    text: input.text,
    status: input.status || "completed",
    threadId: input.threadId || "thread-1",
    turnId: input.turnId || "turn-1",
    createdAt: input.createdAt || "2026-06-01T00:00:00.000Z",
    timestamp: input.timestamp || "00:00",
    metadata: input.metadata,
    tone: input.tone || "neutral",
  };
}

function model(messages: CodexInspectableItem[]): CodexThreadViewModel {
  return {
    status: "ready",
    thread: null,
    activeTurn: null,
    messages,
    planDrafts: [],
    pendingActions: [],
    running: messages.some((message) => message.status === "running"),
    failed: false,
    interrupted: false,
    itemCount: messages.length,
  };
}

describe("CodexThreadTimeline", () => {
  it("keeps running reasoning expanded before the assistant starts", () => {
    const html = renderToStaticMarkup(
      <CodexThreadTimeline
        copy={copy.zh}
        model={model([item({ id: "reasoning", kind: "reasoning", text: "Inspecting", status: "running" })])}
        showReasoningProcess
        canStartBuild={false}
        canContinue={false}
      />,
    );

    expect(html).toContain("reasoning-message\" open");
    expect(html).toContain(copy.zh.settingsModal.thinkingExpanded);
  });

  it("collapses completed reasoning after assistant output starts", () => {
    const html = renderToStaticMarkup(
      <CodexThreadTimeline
        copy={copy.zh}
        model={model([
          item({ id: "reasoning", kind: "reasoning", text: "I should answer.", status: "completed", turnId: "turn-1" }),
          item({ id: "assistant", kind: "assistant", text: "你好", status: "running", turnId: "turn-1" }),
        ])}
        showReasoningProcess
        canStartBuild={false}
        canContinue={false}
      />,
    );

    expect(html).toContain("reasoning-message");
    expect(html).not.toContain("reasoning-message\" open");
    expect(html).toContain(copy.zh.settingsModal.thinkingCollapsed);
  });
});
