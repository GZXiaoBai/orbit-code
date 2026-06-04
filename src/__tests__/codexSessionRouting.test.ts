import { describe, expect, it } from "vitest";
import {
  appendSingleRuntimeErrorItem,
  codexActionSubmitFailure,
  codexRuntimeRestartFailureResult,
  codexComposerSubmitLocked,
  codexRuntimeEventBelongsToActiveOperation,
  codexRuntimeEventBelongsToActiveScope,
  codexComposerLockReason,
  codexOperationIdleTimeoutMs,
  codexRuntimeModeForTurn,
  codexRuntimeRestartTimeoutMs,
  codexRunningTurnIdleTimeoutMs,
  codexStatusEventShouldCreateTimelineError,
  codexSubmissionRoutingDecision,
  codexTurnStartTimeoutMs,
  failRunningCodexTurn,
  finishRuntimeOperation,
  mergeRuntimeOperationPatch,
  recoverCodexRuntimeState,
  recoverStoredItems,
  recoverStoredTurn,
} from "../state/useCodexSession";
import type { CodexItem, CodexThread, CodexTurn } from "../domain/codex";

describe("Codex session runtime routing", () => {
  it("keeps Plan on the direct provider streaming path", () => {
    expect(codexRuntimeModeForTurn("plan")).toBe("direct-deepseek-plan");
  });

  it("routes Build through the Codex app-server path", () => {
    expect(codexRuntimeModeForTurn("build")).toBe("codex-app-server-build");
  });

  it("keeps turn/start bounded so composer submit cannot hang forever", () => {
    expect(codexTurnStartTimeoutMs("direct-deepseek-plan")).toBeGreaterThan(0);
    expect(codexTurnStartTimeoutMs("direct-deepseek-plan")).toBeLessThan(10_000);
    expect(codexTurnStartTimeoutMs("codex-app-server-build")).toBeGreaterThan(codexTurnStartTimeoutMs("direct-deepseek-plan"));
    expect(codexTurnStartTimeoutMs("codex-app-server-build")).toBeGreaterThan(20_000);
    expect(codexTurnStartTimeoutMs("codex-app-server-build")).toBeLessThanOrEqual(30_000);
  });

  it("keeps runtime restart bounded so Settings cannot stay stuck in starting", () => {
    expect(codexRuntimeRestartTimeoutMs()).toBeGreaterThan(15_000);
    expect(codexRuntimeRestartTimeoutMs()).toBeLessThanOrEqual(30_000);
  });

  it("has a UI watchdog for running turns that stop producing runtime events", () => {
    expect(codexRunningTurnIdleTimeoutMs()).toBeGreaterThan(codexTurnStartTimeoutMs("codex-app-server-build"));
    expect(codexRunningTurnIdleTimeoutMs()).toBeLessThanOrEqual(90_000);
  });

  it("uses a longer idle window for direct Plan streaming than for Build startup", () => {
    expect(codexOperationIdleTimeoutMs("direct-deepseek-plan")).toBeGreaterThan(codexRunningTurnIdleTimeoutMs());
    expect(codexOperationIdleTimeoutMs("codex-app-server-build")).toBe(codexRunningTurnIdleTimeoutMs());
  });

  it("does not preflight or restart Codex app-server for desktop Plan submissions", () => {
    const route = codexSubmissionRoutingDecision({
      mode: "plan",
      providerId: "deepseek",
      isDesktopRuntime: true,
    });

    expect(route.runtimeMode).toBe("direct-deepseek-plan");
    expect(route.echoUserItem).toBe(true);
    expect(route.requiresBuildRuntimePreflight).toBe(false);
  });

  it("does not preflight Codex app-server before Build submissions", () => {
    expect(codexSubmissionRoutingDecision({
      mode: "build",
      providerId: "deepseek",
      isDesktopRuntime: true,
    }).requiresBuildRuntimePreflight).toBe(false);

    expect(codexSubmissionRoutingDecision({
      mode: "build",
      providerId: "deepseek",
      isDesktopRuntime: true,
      buildBlockedReason: "Bridge smoke has not passed.",
    }).requiresBuildRuntimePreflight).toBe(false);
  });

  it("uses Plan and Build status errors only to release runtime operations", () => {
    expect(codexStatusEventShouldCreateTimelineError({
      status: "error",
      error: "Plan stream failed",
      operationKind: "plan",
    })).toBe(false);
    expect(codexStatusEventShouldCreateTimelineError({
      status: "error",
      error: "Build start failed",
      operationKind: "build",
    })).toBe(false);
    expect(codexStatusEventShouldCreateTimelineError({
      status: "error",
      error: "Unscoped runtime failure",
    })).toBe(true);
  });

  it("marks a running turn failed when a runtime error arrives asynchronously", () => {
    const turn: CodexTurn = {
      id: "turn-1",
      threadId: "thread-1",
      mode: "plan",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
    };

    expect(failRunningCodexTurn(turn, "2026-05-31T00:00:01.000Z")).toEqual({
      ...turn,
      status: "failed",
      completedAt: "2026-05-31T00:00:01.000Z",
    });
    expect(failRunningCodexTurn({ ...turn, status: "completed" }, "2026-05-31T00:00:01.000Z")?.status).toBe("completed");
  });

  it("locks submit only while a foreground operation is genuinely running", () => {
    const runningTurn: CodexTurn = {
      id: "turn-running",
      threadId: "thread-1",
      mode: "plan",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
    };

    expect(codexComposerSubmitLocked("running", runningTurn)).toBe(false);
    expect(codexComposerSubmitLocked("running", null)).toBe(false);
    expect(codexComposerSubmitLocked("ready", runningTurn)).toBe(false);
    expect(codexComposerSubmitLocked("ready", null, {
      id: "op-plan",
      kind: "plan",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    })).toBe(true);
    expect(codexComposerLockReason("ready", null, {
      id: "op-plan",
      kind: "plan",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    })).toBe("plan:running");
    expect(codexComposerSubmitLocked("starting", null, {
      id: "op-restart",
      kind: "restart",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    })).toBe(false);
    expect(codexComposerSubmitLocked("error", { ...runningTurn, status: "failed" })).toBe(false);
    expect(codexComposerSubmitLocked("ready", { ...runningTurn, status: "interrupted" })).toBe(false);
    expect(codexComposerSubmitLocked("ready", null)).toBe(false);
  });

  it("keeps composer locked only while interrupt operations are active", () => {
    const baseOperation = {
      id: "op-interrupt",
      kind: "interrupt" as const,
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    };

    expect(codexComposerSubmitLocked("running", null, { ...baseOperation, status: "starting" })).toBe(true);
    expect(codexComposerLockReason("running", null, { ...baseOperation, status: "running" })).toBe("interrupt:running");
    expect(codexComposerSubmitLocked("error", null, { ...baseOperation, status: "failed", finalState: "failed" })).toBe(false);
    expect(codexComposerSubmitLocked("ready", null, { ...baseOperation, status: "cancelled", finalState: "cancelled", cancelled: true })).toBe(false);
    expect(codexComposerSubmitLocked("ready", null, { ...baseOperation, status: "completed", finalState: "completed" })).toBe(false);
  });

  it("drops stale runtime events from an older operation", () => {
    const activeOperation = {
      id: "op-current",
      kind: "build" as const,
      status: "running" as const,
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    };

    expect(codexRuntimeEventBelongsToActiveOperation(undefined, activeOperation)).toBe(false);
    expect(codexRuntimeEventBelongsToActiveOperation("op-current", activeOperation)).toBe(true);
    expect(codexRuntimeEventBelongsToActiveOperation("op-stale", activeOperation)).toBe(false);
    expect(codexRuntimeEventBelongsToActiveOperation("op-stale", null)).toBe(false);
  });

  it("accepts untagged events only when they belong to the active turn or thread", () => {
    const activeOperation = {
      id: "op-current",
      kind: "plan" as const,
      status: "running" as const,
      threadId: "thread-1",
      turnId: "turn-1",
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    };
    const activeTurn: CodexTurn = {
      id: "turn-1",
      threadId: "thread-1",
      mode: "plan",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
    };

    expect(codexRuntimeEventBelongsToActiveScope({
      payloadTurnId: "turn-1",
      activeOperation,
      activeTurn,
    })).toBe(true);
    expect(codexRuntimeEventBelongsToActiveScope({
      payloadThreadId: "thread-1",
      activeOperation,
      activeTurn,
    })).toBe(true);
    expect(codexRuntimeEventBelongsToActiveScope({
      payloadTurnId: "turn-old",
      payloadThreadId: "thread-1",
      activeOperation,
      activeTurn,
    })).toBe(false);
    expect(codexRuntimeEventBelongsToActiveScope({
      payloadTurnId: "app-server-turn-1",
      payloadThreadId: "thread-1",
      activeOperation: { ...activeOperation, kind: "build" },
      activeTurn,
    })).toBe(true);
    expect(codexRuntimeEventBelongsToActiveScope({
      payloadTurnId: "turn-new-before-result",
      payloadThreadId: "thread-1",
      activeOperation: { ...activeOperation, turnId: undefined },
      activeTurn: null,
    })).toBe(true);
    expect(codexRuntimeEventBelongsToActiveScope({
      payloadOperationId: "op-old",
      activeOperation,
      activeTurn,
    })).toBe(false);
  });

  it("rejects runtime events from a stale sidecar connection", () => {
    const activeOperation = {
      id: "op-current",
      connectionId: "connection-current",
      kind: "build" as const,
      status: "running" as const,
      threadId: "thread-1",
      turnId: "turn-1",
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    };
    const activeTurn: CodexTurn = {
      id: "turn-1",
      threadId: "thread-1",
      mode: "build",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
    };

    expect(codexRuntimeEventBelongsToActiveScope({
      payloadConnectionId: "connection-old",
      payloadTurnId: "turn-1",
      payloadThreadId: "thread-1",
      activeOperation,
      activeTurn,
    })).toBe(false);
    expect(codexRuntimeEventBelongsToActiveScope({
      payloadConnectionId: "connection-current",
      payloadTurnId: "turn-1",
      activeOperation,
      activeTurn,
    })).toBe(true);
  });

  it("does not downgrade a completed operation when a late running turn result arrives", () => {
    const completed = {
      id: "op-current",
      kind: "build" as const,
      status: "completed" as const,
      finalState: "completed" as const,
      threadId: "thread-1",
      turnId: "app-turn-1",
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
      lastEventAt: "2026-05-31T00:00:05.000Z",
    };

    expect(mergeRuntimeOperationPatch(completed, {
      status: "running",
      turnId: "orbit-turn-1",
      lastEventAt: "2026-05-31T00:00:06.000Z",
      deadlineAt: "2026-05-31T00:02:00.000Z",
    })).toEqual({
      ...completed,
      lastEventAt: "2026-05-31T00:00:06.000Z",
    });
  });

  it("does not downgrade a completed operation when a stale cancel arrives", () => {
    const completed = {
      id: "op-current",
      kind: "build" as const,
      status: "completed" as const,
      finalState: "completed" as const,
      threadId: "thread-1",
      turnId: "app-turn-1",
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
      lastEventAt: "2026-05-31T00:00:05.000Z",
    };

    expect(finishRuntimeOperation(
      completed,
      "failed",
      "Codex operation op-current was cancelled",
      "2026-05-31T00:01:05.000Z",
    )).toEqual(completed);
    expect(finishRuntimeOperation(
      completed,
      "cancelled",
      "Codex operation op-current was cancelled",
      "2026-05-31T00:01:05.000Z",
    )).toEqual(completed);
  });

  it("records final state for active operations", () => {
    const running = {
      id: "op-current",
      kind: "build" as const,
      status: "running" as const,
      threadId: "thread-1",
      turnId: "app-turn-1",
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    };

    expect(finishRuntimeOperation(
      running,
      "failed",
      "Build failed",
      "2026-05-31T00:00:05.000Z",
    )).toEqual({
      ...running,
      status: "failed",
      finalState: "failed",
      cancelled: undefined,
      error: "Build failed",
      lastEventAt: "2026-05-31T00:00:05.000Z",
    });
  });

  it("keeps operation status failures with dedicated error items out of the thread timeline", () => {
    expect(codexStatusEventShouldCreateTimelineError({
      status: "error",
      error: "restart failed",
      operationKind: "restart",
    })).toBe(false);
    expect(codexStatusEventShouldCreateTimelineError({
      status: "error",
      error: "turn failed",
      operationKind: "build",
    })).toBe(false);
  });

  it("upserts one runtime error item per turn/source instead of duplicating cards", () => {
    const thread: CodexThread = {
      id: "thread-1",
      title: "Orbit Codex",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };
    const turn: CodexTurn = {
      id: "turn-1",
      threadId: thread.id,
      mode: "plan",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
    };
    const items: CodexItem[] = [];
    const once = appendSingleRuntimeErrorItem({
      items,
      thread,
      activeTurn: turn,
      message: "Codex app-server initialize response channel disconnected",
      source: "event",
      createdAt: "2026-05-31T00:00:01.000Z",
    });
    const twice = appendSingleRuntimeErrorItem({
      items: once,
      thread,
      activeTurn: turn,
      message: "No active Codex app-server stdin is available",
      source: "event",
      createdAt: "2026-05-31T00:00:02.000Z",
    });

    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({
      kind: "error",
      status: "failed",
      turnId: "turn-1",
      text: "No active Codex app-server stdin is available",
      metadata: { source: "event", recoverable: true },
    });
    expect(twice[0].createdAt).toBe("2026-05-31T00:00:01.000Z");
  });

  it("projects desktop approval submit failures as recoverable non-secret runtime errors", () => {
    const failure = codexActionSubmitFailure({
      action: { id: "approval-1", kind: "command" },
      approved: true,
      error: new Error("No active Codex app-server stdin is available"),
    });

    expect(failure.message).toBe("Codex approval response could not be submitted: No active Codex app-server stdin is available");
    expect(failure.metadata).toEqual({
      source: "approval-submit",
      recoverable: true,
      actionId: "approval-1",
      actionKind: "command",
      approved: true,
      submitError: "No active Codex app-server stdin is available",
    });

    const thread: CodexThread = {
      id: "thread-1",
      title: "Orbit Codex",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };
    const turn: CodexTurn = {
      id: "turn-1",
      threadId: thread.id,
      mode: "build",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
    };

    const first = appendSingleRuntimeErrorItem({
      items: [],
      thread,
      activeTurn: turn,
      message: failure.message,
      source: "approval-submit",
      metadata: failure.metadata,
      createdAt: "2026-05-31T00:00:01.000Z",
    });
    const secondFailure = codexActionSubmitFailure({
      action: { id: "approval-1", kind: "command" },
      approved: true,
      error: "Bridge temporarily unavailable",
    });
    const second = appendSingleRuntimeErrorItem({
      items: first,
      thread,
      activeTurn: turn,
      message: secondFailure.message,
      source: "approval-submit",
      metadata: secondFailure.metadata,
      createdAt: "2026-05-31T00:00:02.000Z",
    });

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      id: "codex-error-turn-1-approval-submit",
      kind: "error",
      title: "Codex error",
      status: "failed",
      text: "Codex approval response could not be submitted: Bridge temporarily unavailable",
      createdAt: "2026-05-31T00:00:01.000Z",
      metadata: {
        source: "approval-submit",
        recoverable: true,
        actionId: "approval-1",
        actionKind: "command",
        approved: true,
        submitError: "Bridge temporarily unavailable",
      },
    });
  });

  it("normalizes restart rejection into a recoverable runtime status result", () => {
    const result = codexRuntimeRestartFailureResult(new Error("spawn codex ENOENT"));

    expect(result).toEqual({
      status: {
        running: false,
        lastError: "spawn codex ENOENT",
      },
      error: "spawn codex ENOENT",
    });
  });

  it("recovers stuck runtime state by cancelling active operations and interrupting running turns", () => {
    const thread: CodexThread = {
      id: "thread-1",
      title: "Orbit Codex",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    };
    const turn: CodexTurn = {
      id: "turn-1",
      threadId: thread.id,
      mode: "build",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
    };
    const operation = {
      id: "op-build",
      kind: "build" as const,
      status: "running" as const,
      threadId: thread.id,
      turnId: turn.id,
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    };

    expect(recoverCodexRuntimeState({
      thread,
      activeTurn: turn,
      activeOperation: operation,
      reason: "Manual recovery",
      completedAt: "2026-05-31T00:00:05.000Z",
    })).toEqual({
      status: "ready",
      activeTurn: {
        ...turn,
        status: "interrupted",
        completedAt: "2026-05-31T00:00:05.000Z",
      },
      activeOperation: {
        ...operation,
        status: "cancelled",
        finalState: "cancelled",
        cancelled: true,
        error: "Manual recovery",
        lastEventAt: "2026-05-31T00:00:05.000Z",
      },
    });
  });

  it("recovers to stopped when no thread exists and leaves terminal operation states alone", () => {
    const completedOperation = {
      id: "op-plan",
      kind: "plan" as const,
      status: "completed" as const,
      finalState: "completed" as const,
      startedAt: "2026-05-31T00:00:00.000Z",
      deadlineAt: "2026-05-31T00:01:00.000Z",
    };

    expect(recoverCodexRuntimeState({
      thread: null,
      activeTurn: null,
      activeOperation: completedOperation,
      reason: "Manual recovery",
      completedAt: "2026-05-31T00:00:05.000Z",
    })).toEqual({
      status: "stopped",
      activeTurn: null,
      activeOperation: completedOperation,
    });
  });

  it("recovers a persisted running turn as interrupted after reload", () => {
    const turn: CodexTurn = {
      id: "turn-reload",
      threadId: "thread-1",
      mode: "plan",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
    };

    expect(recoverStoredTurn(turn, "2026-05-31T00:00:02.000Z")).toEqual({
      ...turn,
      status: "interrupted",
      completedAt: "2026-05-31T00:00:02.000Z",
    });
  });

  it("cleans persisted running output without losing pending actions after reload", () => {
    const base = {
      threadId: "thread-1",
      turnId: "turn-1",
      createdAt: "2026-05-31T00:00:00.000Z",
      metadata: {},
    };
    const recovered = recoverStoredItems([
      {
        ...base,
        id: "empty-assistant",
        kind: "assistant",
        title: "Assistant",
        text: "   ",
        status: "running",
      },
      {
        ...base,
        id: "retry-warning",
        kind: "reasoning",
        title: "Codex app-server retry",
        text: "Reconnecting... 3/5",
        status: "running",
      },
      {
        ...base,
        id: "terminal-running",
        kind: "terminal",
        title: "npm test",
        text: "running...",
        status: "running",
      },
      {
        ...base,
        id: "file-edit-running",
        kind: "fileEdit",
        title: "Agent proposed file edits",
        text: "Preparing patch review...",
        status: "running",
      },
      {
        ...base,
        id: "command-running",
        kind: "command",
        title: "npm test",
        text: "Running command...",
        status: "running",
      },
      {
        ...base,
        id: "approval-pending",
        kind: "approval",
        title: "Command approval",
        text: "Approve npm test",
        status: "running",
      },
      {
        ...base,
        id: "question-pending",
        kind: "question",
        title: "Need input",
        text: "Which path?",
        status: "running",
      },
    ] as CodexItem[]);

    expect(recovered.map((item) => item.id)).toEqual([
      "terminal-running",
      "file-edit-running",
      "command-running",
      "approval-pending",
      "question-pending",
    ]);
    for (const id of ["terminal-running", "file-edit-running", "command-running"]) {
      expect(recovered.find((item) => item.id === id)).toMatchObject({
        status: "failed",
        metadata: { restoredFromRunning: true },
      });
    }
    for (const id of ["approval-pending", "question-pending"]) {
      expect(recovered.find((item) => item.id === id)).toMatchObject({
        status: "pending",
        metadata: { restoredFromRunning: true },
      });
    }
  });
});
