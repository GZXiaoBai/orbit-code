import { describe, expect, it } from "vitest";
import { createActionRequiredEvent } from "../domain/actionRequired";
import type { ThreadEvent } from "../domain/threadEvents";
import { createToolCallLifecycle } from "../domain/toolCallLifecycle";
import { RuntimeLedger, ThreadRuntimeStore } from "../state/threadRuntimeStore";
import { ActionRequiredStore } from "../state/actionRequiredStore";

describe("ThreadRuntimeStore", () => {
  const event: ThreadEvent = {
    id: "event-1",
    kind: "planDraft",
    role: "planner",
    status: "done",
    title: "Plan Draft",
    message: "Draft",
    timestamp: "12:00",
  };

  it("appends and updates runtime events through one store interface", () => {
    const store = new RuntimeLedger();

    store.appendThreadEvent(event);
    const snapshot = store.updateThreadEvent("event-1", { status: "idle", message: "Accepted" });

    expect(snapshot.events).toEqual([
      expect.objectContaining({ id: "event-1", kind: "planDraft", status: "idle", message: "Accepted" }),
    ]);
  });

  it("keeps ThreadRuntimeStore as a compatibility alias for RuntimeLedger", () => {
    const store = new ThreadRuntimeStore();

    const snapshot = store.appendThreadEvent(event);

    expect(snapshot.events[0]).toMatchObject({ id: "event-1" });
  });

  it("records runtime item lifecycle without legacy AgentEvent writes", () => {
    const store = new RuntimeLedger();

    store.appendItem({ ...event, id: "command-1", kind: "commandExecution" });
    store.updateItem("command-1", { message: "running command" });
    store.completeItem("command-1", { message: "command completed" });
    store.appendItem({ ...event, id: "terminal-1", kind: "terminalRun" });
    const snapshot = store.failItem("terminal-1", "terminal failed");

    expect(snapshot.events).toEqual([
      expect.objectContaining({
        id: "command-1",
        runtimeStatus: "completed",
        status: "done",
        message: "command completed",
      }),
      expect.objectContaining({
        id: "terminal-1",
        runtimeStatus: "failed",
        status: "done",
        message: "terminal failed",
      }),
    ]);
  });

  it("replays pending blocking actions without restoring promises", () => {
    const store = new ThreadRuntimeStore();
    store.appendActionRequired(createActionRequiredEvent({
      id: "approval-1",
      kind: "command",
      tool: "run_command",
      workspacePath: "/tmp/project",
      threadId: "thread-1",
      runSessionId: "run-1",
      toolCallId: "tool-1",
      title: "Run command",
      description: "npm test",
    }));

    expect(store.replayPending()).toEqual([
      expect.objectContaining({ id: "approval-1", resumeAction: { type: "approval", payloadId: "approval-1" } }),
    ]);
  });

  it("resolves blocking actions and serializes one runtime snapshot", () => {
    const store = new RuntimeLedger();
    store.appendThreadEvent(event);
    store.appendActionRequired(createActionRequiredEvent({
      id: "approval-1",
      kind: "command",
      tool: "run_command",
      title: "Run command",
      description: "npm test",
      toolResultText: "Approved run_command from smoke harness.",
    }));

    const snapshot = store.resolveActionRequired("approval-1", { approved: true }).actionRequired[0];

    expect(snapshot).toMatchObject({
      id: "approval-1",
      status: "approved",
      toolResultText: "Approved run_command from smoke harness.",
    });
    expect(store.serializeSnapshot()).toEqual({
      threadEvents: [expect.objectContaining({ id: "event-1" })],
      actionRequired: [expect.objectContaining({ id: "approval-1", status: "approved" })],
      toolCalls: [],
      terminalRuns: [],
    });
  });

  it("serializes tool calls, terminal runs, and checkpoint browser inputs in the ledger snapshot", () => {
    const store = new RuntimeLedger();
    store.appendThreadEvent({
      ...event,
      id: "checkpoint-1",
      kind: "checkpoint",
      checkpoint: {
        checkpointId: "checkpoint-1",
        strategy: "file-snapshot",
        filePaths: ["src/App.tsx"],
        status: "created",
      },
    });
    store.appendToolCall(createToolCallLifecycle({
      id: "tool-1",
      tool: "run_command",
      status: "running",
    }));
    store.appendTerminalRun({
      id: "terminal-1",
      taskId: "task-1",
      command: "npm",
      args: ["test"],
      reason: "verify",
      status: "running",
      exitCode: null,
      output: "",
      startedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(store.ledgerSnapshot()).toMatchObject({
      threadEvents: [expect.objectContaining({ id: "checkpoint-1" })],
      toolCalls: [expect.objectContaining({ id: "tool-1", status: "running" })],
      terminalRuns: [expect.objectContaining({ id: "terminal-1" })],
      checkpoints: [expect.objectContaining({ checkpoint: expect.objectContaining({ checkpointId: "checkpoint-1" }) })],
    });
  });

  it("stores runtime snapshots keyed by checkpoint id", () => {
    const store = new RuntimeLedger({ threadEvents: [event] });

    const snapshot = store.saveCheckpointRuntimeSnapshot({
      checkpointId: "checkpoint-1",
      threadId: "thread-1",
      workspacePath: "/tmp/project",
      runtimeLedgerSnapshot: store.serializeSnapshot(),
      createdAt: "2026-05-29T00:00:00.000Z",
    });

    expect(snapshot.checkpointRuntimeSnapshots["checkpoint-1"]).toMatchObject({
      checkpointId: "checkpoint-1",
      runtimeLedgerSnapshot: {
        threadEvents: [expect.objectContaining({ id: "event-1" })],
      },
    });
    expect(store.ledgerSnapshot().checkpointRuntimeSnapshots["checkpoint-1"]).toBeTruthy();
  });

  it("updates tool calls through the ledger without creating duplicate lifecycle facts", () => {
    const store = new RuntimeLedger();
    store.appendToolCall(createToolCallLifecycle({
      id: "tool-1",
      tool: "run_command",
      status: "generated",
      argsSummary: "npm test",
      createdAt: "2026-05-29T00:00:00.000Z",
    }));
    store.appendToolCall(createToolCallLifecycle({
      id: "tool-1",
      tool: "run_command",
      status: "running",
      argsSummary: "npm test",
      createdAt: "2026-05-29T00:00:00.000Z",
    }));
    const snapshot = store.updateToolCall("tool-1", { status: "completed", resultText: "ok" });

    expect(snapshot.toolCalls).toHaveLength(1);
    expect(snapshot.toolCalls[0]).toMatchObject({
      id: "tool-1",
      status: "completed",
      resultText: "ok",
    });
    expect(snapshot.toolCalls[0].updatedAt).toBeTruthy();
  });

  it("expires blocking actions through the ActionRequiredStore", () => {
    const store = new ActionRequiredStore({
      actionRequired: [createActionRequiredEvent({
        id: "question-1",
        kind: "question",
        title: "Question",
        description: "Pick a path",
        question: "Pick a path",
        expiresAt: "2026-05-29T00:00:00.000Z",
      })],
    });

    expect(store.expire("2026-05-29T00:00:01.000Z")[0]).toMatchObject({
      id: "question-1",
      status: "expired",
    });
  });
});
