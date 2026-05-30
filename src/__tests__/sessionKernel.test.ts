import { describe, expect, it } from "vitest";
import { createActionRequiredEvent } from "../domain/actionRequired";
import { createThreadEvent } from "../domain/threadEvents";
import { createCleanSessionRuntime, SessionKernel, sessionNeedsExplicitContinue } from "../state/sessionKernel";

describe("SessionKernel", () => {
  it("creates a clean runtime snapshot for new sessions", () => {
    const clean = createCleanSessionRuntime();

    expect(clean.importedPlan).toBeNull();
    expect(clean.agentRunSession).toBeNull();
    expect(clean.actionRequired).toEqual([]);
    expect(clean.runtimeLedgerSnapshot).toMatchObject({
      threadEvents: [],
      actionRequired: [],
      toolCalls: [],
      terminalRuns: [],
    });
  });

  it("lists sessions from thread state and snapshots", () => {
    const kernel = new SessionKernel();
    const model = kernel.listSessions({
      workspacePath: "/repo",
      activeThreadId: "thread-2",
      threads: [
        { threadId: "thread-1", workspacePath: "/repo", title: "Old", updatedAt: "2026-05-30T00:00:00.000Z" },
        { threadId: "thread-2", workspacePath: "/repo", title: "Active", updatedAt: "2026-05-30T00:01:00.000Z" },
      ],
      snapshots: {
        "thread-2": {
          updatedAt: "2026-05-30T00:02:00.000Z",
          runtimeLedgerSnapshot: {
            threadEvents: [createThreadEvent({
              id: "event-1",
              kind: "agentMessage",
              threadId: "thread-2",
              title: "Summary",
              message: "Done",
            })],
          },
        },
      },
    });

    expect(model.selected?.threadId).toBe("thread-2");
    expect(model.restorePreview).toMatchObject({
      threadId: "thread-2",
      eventCount: 1,
      mode: "read-only",
    });
  });

  it("restores pending actions as explicit-continue work", () => {
    const kernel = new SessionKernel();
    const restored = kernel.restoreSession({
      runtimeLedgerSnapshot: {
        threadEvents: [],
        actionRequired: [createActionRequiredEvent({
          id: "action-1",
          kind: "question",
          title: "Question",
          description: "Pick one",
          question: "Pick one",
        })],
      },
    });

    expect(restored.mode).toBe("pending-action");
    expect(restored.pendingActions[0]).toMatchObject({
      id: "action-1",
      status: "pending",
      resumeAction: { type: "question", payloadId: "action-1" },
    });
    expect(sessionNeedsExplicitContinue(restored)).toBe(true);
  });
});
