import { describe, expect, it } from "vitest";
import {
  appendSingleRuntimeErrorItem,
  codexBuildRuntimeBlockedMessage,
  codexRuntimeRestartFailureResult,
  codexBuildRuntimeReady,
  codexComposerSubmitLocked,
  codexRuntimeModeForTurn,
  codexSubmissionRoutingDecision,
  failRunningCodexTurn,
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

  it("preflights Codex app-server only for unblocked desktop Build submissions", () => {
    expect(codexSubmissionRoutingDecision({
      mode: "build",
      providerId: "deepseek",
      isDesktopRuntime: true,
    }).requiresBuildRuntimePreflight).toBe(true);

    expect(codexSubmissionRoutingDecision({
      mode: "build",
      providerId: "deepseek",
      isDesktopRuntime: true,
      buildBlockedReason: "Bridge smoke has not passed.",
    }).requiresBuildRuntimePreflight).toBe(false);
  });

  it("blocks Build before turn/start when the app-server runtime is not ready", () => {
    expect(codexBuildRuntimeReady({ running: false, lastError: "No active Codex app-server stdin is available" })).toBe(false);
    expect(codexBuildRuntimeBlockedMessage({
      running: false,
      lastError: "No active Codex app-server stdin is available",
    })).toContain("No active Codex app-server stdin is available");
  });

  it("includes exit code and stderr diagnostics in blocked Build messages", () => {
    const message = codexBuildRuntimeBlockedMessage({
      running: false,
      lastError: "Codex app-server exited",
      lastExitCode: 42,
      lastStderrTail: "fatal sidecar crash",
    });

    expect(message).toContain("Codex app-server exited");
    expect(message).toContain("exit code: 42");
    expect(message).toContain("stderr: fatal sidecar crash");
  });

  it("treats a running app-server as ready even when Build will later emit turn items", () => {
    expect(codexBuildRuntimeReady({
      running: true,
      pid: 42842,
      bridgeBaseUrl: "http://127.0.0.1:49152/v1",
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

  it("locks submit only while the active Codex turn is genuinely running", () => {
    const runningTurn: CodexTurn = {
      id: "turn-running",
      threadId: "thread-1",
      mode: "plan",
      status: "running",
      startedAt: "2026-05-31T00:00:00.000Z",
    };

    expect(codexComposerSubmitLocked("running", runningTurn)).toBe(true);
    expect(codexComposerSubmitLocked("running", null)).toBe(true);
    expect(codexComposerSubmitLocked("ready", runningTurn)).toBe(true);
    expect(codexComposerSubmitLocked("error", { ...runningTurn, status: "failed" })).toBe(false);
    expect(codexComposerSubmitLocked("ready", { ...runningTurn, status: "interrupted" })).toBe(false);
    expect(codexComposerSubmitLocked("ready", null)).toBe(false);
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
        status: "pending",
      },
    ] as CodexItem[]);

    expect(recovered.map((item) => item.id)).toEqual(["terminal-running", "approval-pending", "question-pending"]);
    expect(recovered.find((item) => item.id === "terminal-running")).toMatchObject({
      status: "failed",
      metadata: { restoredFromRunning: true },
    });
    expect(recovered.find((item) => item.id === "approval-pending")?.status).toBe("running");
    expect(recovered.find((item) => item.id === "question-pending")?.status).toBe("pending");
  });
});
