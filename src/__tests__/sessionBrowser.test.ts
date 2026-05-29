import { describe, expect, it } from "vitest";
import { createActionRequiredEvent } from "../domain/actionRequired";
import { buildSessionBrowserModel } from "../domain/sessionBrowser";

describe("session browser model", () => {
  it("hides archived sessions by default and exposes them through search", () => {
    const model = buildSessionBrowserModel({
      workspacePath: "/tmp/project",
      activeThreadId: "thread-active",
      searchQuery: "",
      threads: [
        { threadId: "thread-active", workspacePath: "/tmp/project", title: "Active", updatedAt: "2026-05-29T00:00:00.000Z" },
        { threadId: "thread-archived", workspacePath: "/tmp/project", title: "Archived recovery", archived: true, updatedAt: "2026-05-28T00:00:00.000Z" },
      ],
      snapshots: {},
    });

    expect(model.sessions.map((session) => session.threadId)).toEqual(["thread-active"]);

    const searched = buildSessionBrowserModel({
      workspacePath: "/tmp/project",
      searchQuery: "recovery",
      threads: [
        { threadId: "thread-active", workspacePath: "/tmp/project", title: "Active", updatedAt: "2026-05-29T00:00:00.000Z" },
        { threadId: "thread-archived", workspacePath: "/tmp/project", title: "Archived recovery", archived: true, updatedAt: "2026-05-28T00:00:00.000Z" },
      ],
      snapshots: {},
    });

    expect(searched.sessions).toEqual([
      expect.objectContaining({ threadId: "thread-archived", archived: true }),
    ]);
  });

  it("derives pending action counts and restore preview from runtime ledger snapshots", () => {
    const action = createActionRequiredEvent({
      id: "approval-1",
      kind: "command",
      title: "Run command",
      description: "npm test",
    });
    const model = buildSessionBrowserModel({
      workspacePath: "/tmp/project",
      activeThreadId: "thread-1",
      searchQuery: "",
      threads: [{ threadId: "thread-1", workspacePath: "/tmp/project", title: "Smoke", updatedAt: "2026-05-29T00:00:00.000Z" }],
      snapshots: {
        "thread-1": {
          updatedAt: "2026-05-29T00:00:01.000Z",
          runtimeLedgerSnapshot: {
            threadEvents: [{ id: "event-1", kind: "planDraft", role: "planner", status: "done", title: "Plan", message: "Ready", timestamp: "12:00" }],
            actionRequired: [action],
            toolCalls: [],
            terminalRuns: [],
          },
          agentRunSession: { id: "run-1", threadId: "thread-1", workspacePath: "/tmp/project", status: "waiting", resumeKind: "approval" } as any,
        },
      },
    });

    expect(model.sessions[0]).toMatchObject({
      threadId: "thread-1",
      pendingActionCount: 1,
      eventCount: 1,
      lastSummary: "Ready",
    });
    expect(model.restorePreview).toMatchObject({
      threadId: "thread-1",
      pendingActionCount: 1,
      mode: "pending-action",
      hasAgentRunSession: true,
      explicitContinueRequired: true,
    });
  });
});
