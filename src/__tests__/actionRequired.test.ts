import { describe, expect, it } from "vitest";
import {
  actionRequiredToolResult,
  createActionRequiredEvent,
  replayPendingActionRequired,
  resolveActionRequiredEvent,
} from "../domain/actionRequired";

describe("ActionRequiredEvent", () => {
  it("creates pending blocking requests with stable metadata", () => {
    const action = createActionRequiredEvent({
      id: "action-1",
      kind: "command",
      tool: "run_command",
      title: "Run command",
      description: "npm test",
    });

    expect(action.status).toBe("pending");
    expect(action.createdAt).toBeTruthy();
    expect(action.resumeAction).toEqual({ type: "approval", payloadId: "action-1" });
  });

  it("formats approval, denial, cancellation and expiry as tool results", () => {
    const action = createActionRequiredEvent({
      id: "action-1",
      kind: "command",
      tool: "run_command",
      title: "Run command",
      description: "npm test",
    });

    expect(actionRequiredToolResult(resolveActionRequiredEvent(action, { approved: true }))).toContain("Approved run_command");
    expect(actionRequiredToolResult(resolveActionRequiredEvent(action, { approved: false }))).toContain("Denied run_command");
    expect(actionRequiredToolResult(resolveActionRequiredEvent(action, { status: "cancelled" }))).toContain("Cancelled run_command");
    expect(actionRequiredToolResult(resolveActionRequiredEvent(action, { status: "expired" }))).toContain("Expired run_command");
  });

  it("replays pending actions with explicit resume actions", () => {
    const pending = createActionRequiredEvent({
      id: "question-1",
      kind: "question",
      question: "Which path?",
      title: "Question",
      description: "Which path?",
    });
    const resolved = resolveActionRequiredEvent(pending, { status: "resolved", answer: "Safe path" });

    expect(replayPendingActionRequired([pending, resolved])).toEqual([
      expect.objectContaining({ id: "question-1", resumeAction: { type: "question", payloadId: "question-1" } }),
    ]);
  });
});
