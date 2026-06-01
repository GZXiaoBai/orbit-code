import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionRequiredEvent } from "../domain/actionRequired";
import type { CodexItem, CodexRuntimeProjection, CodexRuntimeSettingsModel, CodexRuntimeStatus, CodexSidecarStatus, CodexSidecarVersionInfo, CodexThread, CodexTurn, DesktopBuildSmokeResult, RuntimeRestartResult, RuntimeRoute } from "../domain/codex";
import type { ReasoningEffort, WorkbenchMode } from "../domain/types";
import { agentRuntimePort } from "../runtime/agentRuntimePort";
import { applyCodexItemEvent, applyCodexItemEvents } from "../runtime/codexItemEvents";
import { buildCodexProjection } from "../runtime/codexItemProjection";
import { isDesktopRuntime } from "../runtime/desktopGateway";
import { isTauri } from "../utils/tauri";

const CODEX_SESSION_STORAGE_KEY = "orbit.codexSession.v1";

function now() {
  return new Date().toISOString();
}

function localThread(workspacePath: string, title = "Orbit Codex Thread", threadId?: string): CodexThread {
  const at = now();
  return {
    id: threadId || `codex-thread-${Date.now()}`,
    title,
    workspacePath,
    createdAt: at,
    updatedAt: at,
  };
}

function localTurn(threadId: string, mode: WorkbenchMode): CodexTurn {
  return {
    id: `codex-turn-${Date.now()}`,
    threadId,
    mode,
    status: "completed",
    startedAt: now(),
    completedAt: now(),
  };
}

function localItem(input: Partial<CodexItem> & Pick<CodexItem, "threadId" | "kind" | "title" | "text">): CodexItem {
  return {
    id: input.id || `codex-item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    turnId: input.turnId,
    threadId: input.threadId,
    kind: input.kind,
    title: input.title,
    text: input.text,
    status: input.status || "completed",
    createdAt: input.createdAt || now(),
    metadata: input.metadata,
  };
}

function fixturePlanDraft() {
  return {
    version: "1" as const,
    title: "Fixture planner draft",
    goals: ["Exercise Codex Plan projection"],
    constraints: ["Use Codex item fixtures only"],
    tasks: [{
      id: "fixture-plan-task",
      title: "Fixture planner draft",
      description: "Implement the fixture plan through the Codex sidecar path.",
      status: "queued" as const,
      dependsOn: [],
      filesHint: ["AGENT_GUI_FIXTURE.md"],
      verification: ["npm test"],
    }],
    acceptanceCriteria: ["Codex Plan items render without legacy tool envelopes."],
    risks: [],
    references: [],
  };
}

function fixturePatchSet(flow: string) {
  const baseOld = "# AGENT_GUI_FIXTURE.md\nfixture preview";
  const baseNew = flow === "malformed"
    ? "# AGENT_GUI_FIXTURE.md\n\nMalformed patch corrected by Codex item projection.\n"
    : "# AGENT_GUI_FIXTURE.md\n\nUpdated by Codex fixture.\n";
  const patches = [{
    path: "AGENT_GUI_FIXTURE.md",
    oldContent: baseOld,
    newContent: baseNew,
    applied: false,
    sandboxStatus: "sandboxed",
    sandboxOutput: "Fixture sandbox preview completed. No workspace files were changed.",
    applyStatus: "pending",
  }];
  if (flow === "rollback") {
    patches.push({
      path: "AGENT_GUI_CREATED.md",
      oldContent: "",
      newContent: "# Created File\n\nCreated by Codex fixture.\n",
      applied: false,
      sandboxStatus: "sandboxed",
      sandboxOutput: "Fixture sandbox preview completed. No workspace files were changed.",
      applyStatus: "pending",
    });
  }
  return patches;
}

function fixtureFlow(prompt: string) {
  if (/ASK_USER_FIXTURE/.test(prompt)) return "question";
  if (/MALFORMED_PATCH_FIXTURE/.test(prompt)) return "malformed";
  if (/MULTI_FILE_ROLLBACK_FIXTURE/.test(prompt)) return "rollback";
  if (/INSTALL_FIXTURE/.test(prompt)) return "install";
  return "default";
}

export function recoverStoredTurn(turn: CodexTurn | null | undefined, completedAt = now()): CodexTurn | null {
  if (!turn) return null;
  if (turn.status !== "running") return turn;
  return {
    ...turn,
    status: "interrupted",
    completedAt: turn.completedAt || completedAt,
  };
}

export function recoverStoredItems(items: CodexItem[] | null | undefined): CodexItem[] {
  return (items || [])
    .filter((item) => {
      if ((item.kind === "assistant" || item.kind === "reasoning") && !item.text.trim()) return false;
      if (item.title === "Codex app-server retry" && item.status === "running") return false;
      return true;
    })
    .map((item) => item.status === "running" && item.kind !== "approval" && item.kind !== "question"
      ? {
        ...item,
        status: "failed" as const,
        metadata: { ...(item.metadata || {}), restoredFromRunning: true },
      }
      : item);
}

export function codexRuntimeModeForTurn(mode: WorkbenchMode): RuntimeRoute {
  return mode === "build" ? "codex-app-server-build" : "direct-deepseek-plan";
}

export function codexBuildRuntimeReady(status: CodexSidecarStatus | null | undefined): boolean {
  return Boolean(status?.running);
}

export function codexBuildRuntimeBlockedMessage(status: CodexSidecarStatus | null | undefined, error?: unknown): string {
  const errorMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (errorMessage.trim()) {
    return `Codex Build runtime failed to start: ${errorMessage}`;
  }
  const diagnostics = [
    status?.lastError?.trim(),
    typeof status?.lastExitCode === "number" ? `exit code: ${status.lastExitCode}` : "",
    status?.lastStderrTail?.trim() ? `stderr: ${status.lastStderrTail.trim()}` : "",
  ].filter(Boolean).join(" | ");
  if (diagnostics) {
    return `Codex Build runtime is not ready: ${diagnostics}`;
  }
  return "Codex Build runtime is not ready. Restart the Codex runtime from Settings before starting Build.";
}

export function codexSubmissionRoutingDecision(input: {
  mode: WorkbenchMode;
  providerId: string;
  isDesktopRuntime: boolean;
  buildBlockedReason?: string;
}) {
  const runtimeMode = codexRuntimeModeForTurn(input.mode);
  const isFixture = input.providerId === "fixture";
  const buildBlocked = Boolean(input.buildBlockedReason);
  const requiresBuildRuntimePreflight = input.isDesktopRuntime
    && runtimeMode === "codex-app-server-build"
    && !isFixture
    && !buildBlocked;
  return {
    runtimeMode,
    echoUserItem: isFixture || !input.isDesktopRuntime || runtimeMode !== "codex-app-server-build" || buildBlocked,
    requiresBuildRuntimePreflight,
  };
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    promise
      .then(resolve, reject)
      .finally(() => globalThis.clearTimeout(timer));
  });
}

function runtimeErrorId(turnId: string | undefined, source: string) {
  return `codex-error-${turnId || "session"}-${source.replace(/[^a-z0-9_-]/gi, "-")}`;
}

export function failRunningCodexTurn(turn: CodexTurn | null, completedAt = now()): CodexTurn | null {
  if (!turn || turn.status !== "running") return turn;
  return { ...turn, status: "failed", completedAt };
}

export function codexComposerSubmitLocked(status: CodexRuntimeStatus, activeTurn: CodexTurn | null): boolean {
  return status === "running" || activeTurn?.status === "running";
}

export function appendSingleRuntimeErrorItem(input: {
  items: CodexItem[];
  thread: CodexThread | null;
  activeTurn: CodexTurn | null;
  message: string;
  source?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): CodexItem[] {
  const message = input.message.trim() || "Unknown Codex runtime error";
  const source = input.source || "runtime";
  const threadId = input.thread?.id || input.activeTurn?.threadId;
  if (!threadId) return input.items;
  const turnId = input.activeTurn?.id;
  const id = runtimeErrorId(turnId, source);
  const next: CodexItem = {
    id,
    threadId,
    turnId,
    kind: "error",
    title: input.title || "Codex error",
    text: message,
    status: "failed",
    createdAt: input.createdAt || now(),
    metadata: {
      source,
      recoverable: true,
      ...(input.metadata || {}),
    },
  };
  const existingIndex = input.items.findIndex((item) => (
    item.id === id
    || (item.kind === "error" && item.turnId === turnId && item.text.trim() === message)
  ));
  if (existingIndex === -1) return [...input.items, next];
  return input.items.map((item, index) => index === existingIndex ? {
    ...item,
    ...next,
    id: item.id,
    createdAt: item.createdAt,
    metadata: { ...(item.metadata || {}), ...(next.metadata || {}) },
  } : item);
}

export function codexRuntimeRestartFailureResult(error: unknown): RuntimeRestartResult {
  const message = error instanceof Error ? error.message : String(error || "Unknown Codex runtime restart error");
  return {
    status: {
      running: false,
      lastError: message,
    },
    error: message,
  };
}

export function useCodexSession() {
  const restored = useMemo(() => {
    try {
      const raw = localStorage.getItem(CODEX_SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) as { thread?: CodexThread | null; activeTurn?: CodexTurn | null; items?: CodexItem[] } : null;
    } catch {
      return null;
    }
  }, []);
  const [status, setStatus] = useState<CodexRuntimeStatus>(restored?.thread ? "ready" : "stopped");
  const [thread, setThread] = useState<CodexThread | null>(restored?.thread || null);
  const [activeTurn, setActiveTurn] = useState<CodexTurn | null>(() => recoverStoredTurn(restored?.activeTurn));
  const [items, setItems] = useState<CodexItem[]>(() => recoverStoredItems(restored?.items));
  const [error, setError] = useState<string | undefined>();
  const [sidecarStatus, setSidecarStatus] = useState<CodexSidecarStatus>({ running: false });
  const [sidecarInfo, setSidecarInfo] = useState<CodexSidecarVersionInfo | undefined>();
  const [desktopBuildSmokeReport, setDesktopBuildSmokeReport] = useState<DesktopBuildSmokeResult | undefined>();
  const threadRef = useRef<CodexThread | null>(thread);
  const statusRef = useRef<CodexRuntimeStatus>(status);
  const activeTurnRef = useRef<CodexTurn | null>(activeTurn);

  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    activeTurnRef.current = activeTurn;
  }, [activeTurn]);

  const projection: CodexRuntimeProjection = useMemo(() => buildCodexProjection({
    status,
    thread,
    activeTurn,
    items,
    error,
  }), [activeTurn, error, items, status, thread]);

  useEffect(() => {
    localStorage.setItem(CODEX_SESSION_STORAGE_KEY, JSON.stringify({ thread, activeTurn, items }));
  }, [activeTurn, items, thread]);

  const recordRuntimeError = useCallback((message: string, metadata: Record<string, unknown> = {}) => {
    setStatus("error");
    setError(message);
    setActiveTurn((prev) => failRunningCodexTurn(prev));
    setItems((prev) => appendSingleRuntimeErrorItem({
      items: prev,
      thread: threadRef.current,
      activeTurn: activeTurnRef.current,
      message,
      source: String(metadata.source || "runtime"),
      metadata,
    }));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    return agentRuntimePort.subscribe((event) => {
      if (event.type === "item") {
        setItems((prev) => applyCodexItemEvent(prev, event.payload));
        return;
      }
      if (event.type === "turn") {
        setActiveTurn(event.payload);
        setStatus(event.payload.status === "running" ? "running" : event.payload.status === "failed" ? "error" : "ready");
        return;
      }
      if (event.type === "status") {
        setStatus(event.payload.status);
        setError(event.payload.error);
        if (event.payload.status === "error" && event.payload.error) {
          recordRuntimeError(event.payload.error, { source: "status" });
        }
        return;
      }
      recordRuntimeError(event.payload.message, { source: "event" });
    });
  }, [recordRuntimeError]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void agentRuntimePort.status()
      .then(setSidecarStatus)
      .catch((err) => setSidecarStatus({ running: false, lastError: err instanceof Error ? err.message : String(err) }));
    void agentRuntimePort.sidecarInfo()
      .then(setSidecarInfo)
      .catch((err) => setSidecarInfo({ source: err instanceof Error ? err.message : String(err) }));
    void agentRuntimePort.desktopBuildSmokeReport()
      .then((report) => setDesktopBuildSmokeReport(report || undefined))
      .catch(() => setDesktopBuildSmokeReport(undefined));
  }, []);

  const runtimeSettings: CodexRuntimeSettingsModel = useMemo(() => ({
    sidecarStatus,
    sidecarInfo,
    sidecarPath: sidecarInfo?.path,
    bridgeStatus: sidecarStatus.running ? "ready" : sidecarStatus.lastError ? "error" : "stopped",
    bridgeBaseUrl: sidecarStatus.bridgeBaseUrl,
    activeProvider: undefined,
    lastError: sidecarStatus.lastError,
    latestDesktopBuildSmoke: desktopBuildSmokeReport,
  }), [desktopBuildSmokeReport, sidecarInfo, sidecarStatus]);

  const ensureThread = useCallback(async (input: {
    workspacePath: string;
    mode: WorkbenchMode;
    providerId: string;
    model: string;
    threadId?: string;
    title?: string;
  }) => {
    if (thread?.workspacePath === input.workspacePath && (!input.threadId || thread.id === input.threadId)) return thread;
    const created = localThread(input.workspacePath, input.title, input.threadId);
    setThread(created);
    setStatus("ready");
    setError(undefined);
    return created;
  }, [thread]);

  const submit = useCallback(async (input: {
    prompt: string;
    workspacePath: string;
    mode: WorkbenchMode;
    providerId: string;
    model: string;
    threadId?: string;
    reasoningEffort?: ReasoningEffort;
    buildBlockedReason?: string;
  }) => {
    if (codexComposerSubmitLocked(statusRef.current, activeTurnRef.current)) {
      return;
    }
    const activeThread = await ensureThread({
      workspacePath: input.workspacePath,
      mode: input.mode,
      providerId: input.providerId,
      model: input.model,
      threadId: input.threadId,
    });
    const desktopRuntime = isDesktopRuntime();
    const route = codexSubmissionRoutingDecision({
      mode: input.mode,
      providerId: input.providerId,
      isDesktopRuntime: desktopRuntime,
      buildBlockedReason: input.buildBlockedReason,
    });
    const runtimeMode = route.runtimeMode;
    if (route.echoUserItem) {
      const userItem = localItem({
        threadId: activeThread.id,
        kind: "user",
        title: "User",
        text: input.prompt,
      });
      setItems((prev) => [...prev, userItem]);
    }
    setStatus("running");
    if (input.mode === "build" && input.buildBlockedReason) {
      const turn = {
        ...localTurn(activeThread.id, input.mode),
        status: "failed" as const,
      };
      setActiveTurn(turn);
      setItems((prev) => [...prev, localItem({
        threadId: activeThread.id,
        turnId: turn.id,
        kind: "error",
        title: "Build blocked",
        text: input.buildBlockedReason || "Build is not available for the selected provider or model.",
        status: "failed",
        metadata: {
          code: "provider_build_gate_blocked",
          providerId: input.providerId,
          model: input.model,
          runtimeMode,
        },
      })]);
      setStatus("error");
      return;
    }
    if (input.mode === "build" && (!input.providerId || !input.model)) {
      const turn = { ...localTurn(activeThread.id, input.mode), status: "failed" as const };
      setActiveTurn(turn);
      setItems((prev) => [...prev, localItem({
        threadId: activeThread.id,
        turnId: turn.id,
        kind: "error",
        title: "Model unavailable",
        text: "当前没有可用模型。请先导入并解锁一个支持 Build 的 Codex bridge 模型。",
        status: "failed",
      })]);
      setStatus("error");
      return;
    }
    if (input.mode === "build" && input.providerId === "ollama") {
      const turn = { ...localTurn(activeThread.id, input.mode), status: "failed" as const };
      setActiveTurn(turn);
      setItems((prev) => [...prev, localItem({
        threadId: activeThread.id,
        turnId: turn.id,
        kind: "error",
        title: "Provider blocked",
        text: "Ollama 当前仅接入模型发现，Build 尚未接入 Codex Responses bridge。",
        status: "failed",
      })]);
      setStatus("error");
      return;
    }
    if (input.providerId === "fixture") {
      const turn = localTurn(activeThread.id, input.mode);
      setActiveTurn(turn);
      const flow = fixtureFlow(input.prompt);
      if (input.mode === "plan") {
        setItems((prev) => [...prev,
          localItem({
            threadId: activeThread.id,
            turnId: turn.id,
            kind: "reasoning",
            title: "Codex Plan Reasoning",
            text: "Fixture planner collected context and prepared a Codex plan draft.",
          }),
          localItem({
            threadId: activeThread.id,
            turnId: turn.id,
            kind: "planDraft",
            title: "Plan Draft",
            text: "Fixture planner draft is ready. Accept and enter Build.",
            metadata: { plan: fixturePlanDraft() },
          }),
        ]);
      } else if (flow === "question") {
        setItems((prev) => [...prev, localItem({
          threadId: activeThread.id,
          turnId: turn.id,
          kind: "question",
          title: "Which implementation path?",
          text: "Which implementation path should Codex use?",
          status: "pending",
          metadata: {
            allowFreeform: true,
            options: [
              { id: "safe", label: "Safe fixture path", description: "Read the package manifest before editing.", recommended: true },
              { id: "fast", label: "Fast fixture path", description: "Apply the minimal patch immediately." },
            ],
          },
        })]);
      } else {
        const command = flow === "install" ? "npm install" : "npm test";
        setItems((prev) => [...prev, localItem({
          threadId: activeThread.id,
          turnId: turn.id,
          kind: "approval",
          title: flow === "install" ? "Install approval" : "Command approval",
          text: flow === "install" ? "Codex requests permission to run npm install." : "Codex requests permission to run npm test.",
          status: "pending",
          metadata: {
            flow,
            actionKind: flow === "install" ? "install" : "command",
            tool: "run_command",
            params: { command: command.split(" ")[0], args: command.split(" ").slice(1), cwd: input.workspacePath },
          },
        })]);
      }
      setStatus("ready");
      return;
    }
    if (!desktopRuntime) {
      const turn = localTurn(activeThread.id, input.mode);
      const assistant = localItem({
        threadId: activeThread.id,
        turnId: turn.id,
        kind: "assistant",
        title: "Codex Sidecar Required",
        text: "Codex sidecar execution requires the Tauri desktop runtime. The old frontend Agent loop has been removed.",
      });
      setActiveTurn(turn);
      setItems((prev) => [...prev, assistant]);
      setStatus("ready");
      return;
    }
    const failWithSingleRuntimeError = (message: string, metadata: Record<string, unknown> = {}) => {
      const failedTurn = { ...localTurn(activeThread.id, input.mode), status: "failed" as const };
      setActiveTurn(failedTurn);
      setError(message);
      setStatus("error");
      setItems((prev) => [...prev, localItem({
        threadId: activeThread.id,
        turnId: failedTurn.id,
        kind: "error",
        title: runtimeMode === "codex-app-server-build" ? "Codex Build blocked" : "Codex Runtime Error",
        text: message,
        status: "failed",
        metadata: {
          code: runtimeMode === "codex-app-server-build" ? "codex_build_runtime_not_ready" : "codex_runtime_failed",
          providerId: input.providerId,
          model: input.model,
          runtimeMode,
          ...metadata,
        },
      })]);
    };

    try {
      if (route.requiresBuildRuntimePreflight) {
        setStatus("starting");
        const currentStatus = await withTimeout(agentRuntimePort.status(), 1500, "Codex Build runtime status").catch((err) => {
          throw new Error(codexBuildRuntimeBlockedMessage(undefined, err));
        });
        setSidecarStatus(currentStatus);
        if (!codexBuildRuntimeReady(currentStatus)) {
          failWithSingleRuntimeError(codexBuildRuntimeBlockedMessage(currentStatus), {
            runtimeStatus: currentStatus,
            recoverable: true,
          });
          return;
        }
        setError(undefined);
      }
      const result = await agentRuntimePort.startTurn({
        threadId: activeThread.id,
        workspacePath: input.workspacePath,
        prompt: input.prompt,
        mode: input.mode,
        runtimeMode,
        providerId: input.providerId,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
      });
      setActiveTurn(result.turn);
      setItems((prev) => applyCodexItemEvents(prev, result.items));
      setStatus(result.turn.status === "failed" ? "error" : result.turn.status === "running" ? "running" : "ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failWithSingleRuntimeError(message);
    }
  }, [ensureThread]);

  const interrupt = useCallback(async () => {
    if (!activeTurn || !thread) return;
    try {
      await agentRuntimePort.interruptTurn(thread.id, activeTurn.id);
    } finally {
      setActiveTurn((prev) => prev ? { ...prev, status: "interrupted", completedAt: now() } : prev);
      setStatus("ready");
    }
  }, [activeTurn, thread]);

  const resolveAction = useCallback(async (action: ActionRequiredEvent, approved: boolean, answer?: string) => {
    const knownTarget = items.find((item) => item.id === action.id);
    const fixtureAction = typeof knownTarget?.metadata?.flow === "string";
    if (isDesktopRuntime() && !fixtureAction) {
      await agentRuntimePort.submitApproval(action.id, approved, answer).catch(() => undefined);
      return;
    }
    setItems((prev) => {
      const target = prev.find((item) => item.id === action.id);
      const updated = prev.map((item) => item.id === action.id
        ? { ...item, status: approved ? "completed" as const : "denied" as const, text: answer || item.text, metadata: { ...(item.metadata || {}), answer } }
        : item);
      if (!target) return updated;
      if (!approved) {
        return [...updated, localItem({
          threadId: target.threadId,
          turnId: target.turnId,
          kind: "assistant",
          title: "Codex approval denied",
          text: `Codex action denied: ${target.title}`,
          status: "denied",
        })];
      }
      if (target.kind === "question") {
        return [...updated, localItem({
          threadId: target.threadId,
          turnId: target.turnId,
          kind: "assistant",
          title: "Codex question answered",
          text: answer || "Safe fixture path",
        })];
      }
      const flow = typeof target.metadata?.flow === "string" ? target.metadata.flow : "default";
      const command = flow === "install" ? "npm install" : "npm test";
      return [...updated,
        localItem({
          threadId: target.threadId,
          turnId: target.turnId,
          kind: "terminal",
          title: command,
          text: "Desktop runtime required for command execution.\n[exit_code: 1]",
          metadata: { command, exitCode: 1 },
        }),
        localItem({
          threadId: target.threadId,
          turnId: target.turnId,
          kind: "fileEdit",
          title: "Agent proposed file edits",
          text: "Codex proposed changes for review.",
          metadata: { patches: fixturePatchSet(flow) },
        }),
        localItem({
          threadId: target.threadId,
          turnId: target.turnId,
          kind: "assistant",
          title: "Codex final summary",
          text: "Codex fixture Build turn completed with command output and file edit items.",
        }),
        localItem({
          threadId: target.threadId,
          turnId: target.turnId,
          kind: "usage",
          title: "Token usage",
          text: "prompt=128 completion=64 total=192",
          metadata: { promptTokens: 128, completionTokens: 64, totalTokens: 192 },
        }),
      ];
    });
  }, [items]);

  const clear = useCallback(() => {
    setThread(null);
    setActiveTurn(null);
    setItems([]);
    setError(undefined);
    setStatus("stopped");
    localStorage.removeItem(CODEX_SESSION_STORAGE_KEY);
  }, []);

  const restartRuntime = useCallback(async (providerId = "deepseek") => {
    setStatus("starting");
    try {
      const result = await agentRuntimePort.restart(providerId);
      setSidecarStatus(result.status);
      setError(result.error || result.status.lastError);
      setStatus(result.status.running ? "ready" : "error");
      void agentRuntimePort.sidecarInfo()
        .then(setSidecarInfo)
        .catch(() => undefined);
      return result;
    } catch (err) {
      const result = codexRuntimeRestartFailureResult(err);
      setSidecarStatus(result.status);
      setError(result.error);
      setStatus("error");
      return result;
    }
  }, []);

  return {
    status,
    thread,
    activeTurn,
    items,
    projection,
    runtimeSettings,
    submit,
    interrupt,
    resolveAction,
    restartRuntime,
    clear,
  };
}
