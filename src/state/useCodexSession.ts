import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionRequiredEvent } from "../domain/actionRequired";
import type { CodexItem, CodexRuntimeDiagnostics, CodexRuntimeProjection, CodexRuntimeSettingsModel, CodexRuntimeStatus, CodexSidecarStatus, CodexSidecarVersionInfo, CodexThread, CodexTurn, DesktopBuildSmokeResult, FreezeDiagnosticReport, RuntimeOperation, RuntimeOperationKind, RuntimeRestartResult, RuntimeRoute } from "../domain/codex";
import type { ReasoningEffort, WorkbenchMode } from "../domain/types";
import { agentRuntimePort } from "../runtime/agentRuntimePort";
import { applyCodexItemEvent, applyCodexItemEvents } from "../runtime/codexItemEvents";
import { buildCodexProjection } from "../runtime/codexItemProjection";
import { isDesktopRuntime } from "../runtime/desktopGateway";
import { isTauri } from "../utils/tauri";

const CODEX_SESSION_STORAGE_KEY = "orbit.codexSession.v1";
const DIRECT_PLAN_TURN_START_TIMEOUT_MS = 6_000;
const BUILD_TURN_START_TIMEOUT_MS = 25_000;
const CODEX_RUNTIME_RESTART_TIMEOUT_MS = 25_000;
const RUNNING_TURN_IDLE_TIMEOUT_MS = 60_000;
const DIRECT_PLAN_OPERATION_IDLE_TIMEOUT_MS = 180_000;

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

function operationId(kind: RuntimeOperationKind) {
  return `codex-operation-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function operationDeadlineFromNow(timeoutMs: number) {
  return new Date(Date.now() + timeoutMs).toISOString();
}

function operationFor(input: {
  kind: RuntimeOperationKind;
  timeoutMs: number;
  threadId?: string;
  turnId?: string;
}): RuntimeOperation {
  const started = Date.now();
  return {
    id: operationId(input.kind),
    kind: input.kind,
    status: "starting",
    threadId: input.threadId,
    turnId: input.turnId,
    startedAt: new Date(started).toISOString(),
    deadlineAt: new Date(started + input.timeoutMs).toISOString(),
  };
}

function isOperationActive(operation: RuntimeOperation | null | undefined): operation is RuntimeOperation {
  return operation?.status === "starting" || operation?.status === "running";
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
    .map((item) => {
      if (item.status !== "running") return item;
      if (item.kind === "approval" || item.kind === "question") {
        return {
          ...item,
          status: "pending" as const,
          metadata: { ...(item.metadata || {}), restoredFromRunning: true },
        };
      }
      return {
        ...item,
        status: "failed" as const,
        metadata: { ...(item.metadata || {}), restoredFromRunning: true },
      };
    });
}

export function codexRuntimeModeForTurn(mode: WorkbenchMode): RuntimeRoute {
  return mode === "build" ? "codex-app-server-build" : "direct-deepseek-plan";
}

export function codexTurnStartTimeoutMs(runtimeMode: RuntimeRoute): number {
  return runtimeMode === "codex-app-server-build"
    ? BUILD_TURN_START_TIMEOUT_MS
    : DIRECT_PLAN_TURN_START_TIMEOUT_MS;
}

export function codexRuntimeRestartTimeoutMs(): number {
  return CODEX_RUNTIME_RESTART_TIMEOUT_MS;
}

export function codexRunningTurnIdleTimeoutMs(): number {
  return RUNNING_TURN_IDLE_TIMEOUT_MS;
}

export function codexOperationIdleTimeoutMs(runtimeMode: RuntimeRoute): number {
  return runtimeMode === "direct-deepseek-plan"
    ? DIRECT_PLAN_OPERATION_IDLE_TIMEOUT_MS
    : RUNNING_TURN_IDLE_TIMEOUT_MS;
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
  const requiresBuildRuntimePreflight = false;
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

export function codexComposerSubmitLocked(
  status: CodexRuntimeStatus,
  activeTurn: CodexTurn | null,
  activeOperation?: RuntimeOperation | null,
): boolean {
  void status;
  void activeTurn;
  const operationBlocksComposer = activeOperation
    ? isOperationActive(activeOperation)
      && (activeOperation.kind === "plan" || activeOperation.kind === "build" || activeOperation.kind === "interrupt")
    : false;
  return operationBlocksComposer;
}

export function codexComposerLockReason(
  status: CodexRuntimeStatus,
  activeTurn: CodexTurn | null,
  activeOperation?: RuntimeOperation | null,
): string | undefined {
  if (!codexComposerSubmitLocked(status, activeTurn, activeOperation)) return undefined;
  if (!activeOperation) return undefined;
  return `${activeOperation.kind}:${activeOperation.status}`;
}

export function codexRuntimeEventBelongsToActiveOperation(
  payloadOperationId: string | undefined,
  activeOperation?: RuntimeOperation | null,
): boolean {
  if (!payloadOperationId) return !isOperationActive(activeOperation);
  if (!activeOperation?.id) return false;
  return payloadOperationId === activeOperation.id;
}

export function codexRuntimeEventBelongsToActiveScope(input: {
  payloadOperationId?: string;
  payloadConnectionId?: string;
  payloadTurnId?: string;
  payloadThreadId?: string;
  activeOperation?: RuntimeOperation | null;
  activeTurn?: CodexTurn | null;
}): boolean {
  const { payloadOperationId, payloadConnectionId, payloadTurnId, payloadThreadId, activeOperation, activeTurn } = input;
  if (payloadConnectionId && activeOperation?.connectionId && payloadConnectionId !== activeOperation.connectionId) {
    return false;
  }
  if (payloadOperationId) {
    return activeOperation?.id === payloadOperationId;
  }
  if (!isOperationActive(activeOperation)) return true;
  if (payloadTurnId) {
    if (activeOperation?.turnId === payloadTurnId || activeTurn?.id === payloadTurnId) return true;
    if (
      activeOperation?.kind === "build"
      && payloadThreadId
      && activeOperation.threadId === payloadThreadId
    ) {
      return true;
    }
    if (activeOperation?.turnId) return false;
  }
  if (payloadThreadId && activeOperation?.threadId) {
    return activeOperation.threadId === payloadThreadId;
  }
  return false;
}

export function mergeRuntimeOperationPatch(
  current: RuntimeOperation,
  patch: Partial<RuntimeOperation>,
): RuntimeOperation {
  const currentIsTerminal = current.status !== "starting" && current.status !== "running";
  if (currentIsTerminal && (patch.status === "starting" || patch.status === "running")) {
    const next = {
      ...current,
      lastEventAt: patch.lastEventAt || current.lastEventAt,
    };
    if (!next.threadId && patch.threadId) next.threadId = patch.threadId;
    if (!next.turnId && patch.turnId) next.turnId = patch.turnId;
    if (!next.connectionId && patch.connectionId) next.connectionId = patch.connectionId;
    return next;
  }
  return { ...current, ...patch };
}

export function finishRuntimeOperation(
  current: RuntimeOperation,
  finalState: "completed" | "failed" | "cancelled",
  error?: string,
  completedAt = now(),
): RuntimeOperation {
  if (!isOperationActive(current)) return current;
  return {
    ...current,
    status: finalState,
    finalState,
    cancelled: finalState === "cancelled" ? true : current.cancelled,
    error,
    lastEventAt: completedAt,
  };
}

export function codexStatusEventShouldCreateTimelineError(input: {
  status: CodexRuntimeStatus;
  error?: string;
  operationKind?: string;
}): boolean {
  return input.status === "error"
    && Boolean(input.error)
    && input.operationKind !== "restart"
    && input.operationKind !== "plan"
    && input.operationKind !== "build";
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export function codexActionSubmitFailure(input: {
  action: Pick<ActionRequiredEvent, "id" | "kind">;
  approved: boolean;
  error: unknown;
}) {
  const submitTarget = input.action.kind === "question" ? "question answer" : "approval response";
  const message = `Codex ${submitTarget} could not be submitted: ${errorMessage(input.error)}`;
  return {
    message,
    metadata: {
      source: "approval-submit",
      recoverable: true,
      actionId: input.action.id,
      actionKind: input.action.kind,
      approved: input.approved,
      submitError: errorMessage(input.error),
    },
  };
}

export function codexRuntimeRestartFailureResult(error: unknown): RuntimeRestartResult {
  const message = errorMessage(error || "Unknown Codex runtime restart error");
  return {
    status: {
      running: false,
      lastError: message,
    },
    error: message,
  };
}

export function recoverCodexRuntimeState(input: {
  thread: CodexThread | null;
  activeTurn: CodexTurn | null;
  activeOperation: RuntimeOperation | null;
  reason: string;
  completedAt?: string;
}): {
  status: CodexRuntimeStatus;
  activeTurn: CodexTurn | null;
  activeOperation: RuntimeOperation | null;
} {
  const completedAt = input.completedAt || now();
  return {
    status: input.thread ? "ready" : "stopped",
    activeTurn: input.activeTurn?.status === "running"
      ? { ...input.activeTurn, status: "interrupted", completedAt }
      : input.activeTurn,
    activeOperation: isOperationActive(input.activeOperation)
      ? {
        ...input.activeOperation,
        status: "cancelled",
        finalState: "cancelled",
        cancelled: true,
        error: input.reason,
        lastEventAt: completedAt,
      }
      : input.activeOperation,
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
  const [diagnostics, setDiagnostics] = useState<CodexRuntimeDiagnostics | undefined>();
  const [desktopBuildSmokeReport, setDesktopBuildSmokeReport] = useState<DesktopBuildSmokeResult | undefined>();
  const [activeOperation, setActiveOperation] = useState<RuntimeOperation | null>(null);
  const [staleEventCount, setStaleEventCount] = useState(0);
  const threadRef = useRef<CodexThread | null>(thread);
  const statusRef = useRef<CodexRuntimeStatus>(status);
  const activeTurnRef = useRef<CodexTurn | null>(activeTurn);
  const itemsRef = useRef<CodexItem[]>(items);
  const activeOperationRef = useRef<RuntimeOperation | null>(activeOperation);
  const ignoredTurnIdsRef = useRef<Set<string>>(new Set());
  const turnWatchdogRef = useRef<number | undefined>(undefined);
  const operationDeadlineRef = useRef<number | undefined>(undefined);
  const restartInFlightRef = useRef<Promise<RuntimeRestartResult> | null>(null);
  const staleEventCountRef = useRef(0);

  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    activeTurnRef.current = activeTurn;
  }, [activeTurn]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    activeOperationRef.current = activeOperation;
  }, [activeOperation]);

  useEffect(() => {
    staleEventCountRef.current = staleEventCount;
  }, [staleEventCount]);

  const recordStaleRuntimeEvent = useCallback(() => {
    setStaleEventCount((count) => count + 1);
  }, []);

  const clearTurnWatchdog = useCallback(() => {
    if (turnWatchdogRef.current) {
      globalThis.clearTimeout(turnWatchdogRef.current);
      turnWatchdogRef.current = undefined;
    }
  }, []);

  const clearOperationDeadline = useCallback(() => {
    if (operationDeadlineRef.current) {
      globalThis.clearTimeout(operationDeadlineRef.current);
      operationDeadlineRef.current = undefined;
    }
  }, []);

  const beginOperation = useCallback((input: {
    kind: RuntimeOperationKind;
    timeoutMs: number;
    threadId?: string;
    turnId?: string;
  }) => {
    const operation = operationFor(input);
    setActiveOperation(operation);
    activeOperationRef.current = operation;
    return operation;
  }, []);

  const patchOperation = useCallback((operationId: string, patch: Partial<RuntimeOperation>) => {
    const currentRef = activeOperationRef.current;
    if (currentRef?.id === operationId) {
      const nextRef = mergeRuntimeOperationPatch(currentRef, patch);
      activeOperationRef.current = nextRef;
      if (!isOperationActive(nextRef)) clearOperationDeadline();
    }
    setActiveOperation((current) => {
      if (!current || current.id !== operationId) return current;
      const next = mergeRuntimeOperationPatch(current, patch);
      activeOperationRef.current = next;
      if (!isOperationActive(next)) clearOperationDeadline();
      return next;
    });
  }, [clearOperationDeadline]);

  const finishOperation = useCallback((operationId: string, finalState: "completed" | "failed" | "cancelled", error?: string) => {
    const currentRef = activeOperationRef.current;
    if (currentRef?.id === operationId) {
      const nextRef = finishRuntimeOperation(currentRef, finalState, error);
      activeOperationRef.current = nextRef;
      if (!isOperationActive(nextRef)) clearOperationDeadline();
    }
    setActiveOperation((current) => {
      if (!current || current.id !== operationId) return current;
      const next = finishRuntimeOperation(current, finalState, error);
      activeOperationRef.current = next;
      if (!isOperationActive(next)) clearOperationDeadline();
      return next;
    });
  }, [clearOperationDeadline]);

  const cancelOperation = useCallback(async (operation: RuntimeOperation, reason: string) => {
    ignoredTurnIdsRef.current = new Set([
      ...ignoredTurnIdsRef.current,
      ...(operation.turnId ? [operation.turnId] : []),
    ]);
    finishOperation(operation.id, "failed", reason);
    setError(reason);
    if (operation.kind === "restart") {
      setStatus(sidecarStatus.running ? "ready" : "error");
    } else {
      setStatus("error");
      setActiveTurn((prev) => prev && prev.id === operation.turnId ? { ...prev, status: "failed", completedAt: now() } : prev);
    }
    if (isDesktopRuntime()) {
      await agentRuntimePort.cancelOperation(operation.id).catch(() => undefined);
      await agentRuntimePort.diagnostics().then(setDiagnostics).catch(() => undefined);
    }
  }, [finishOperation, sidecarStatus.running]);

  useEffect(() => {
    clearOperationDeadline();
    if (!activeOperation || !isOperationActive(activeOperation)) return;
    const deadline = new Date(activeOperation.deadlineAt).getTime();
    const delay = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0;
    operationDeadlineRef.current = globalThis.setTimeout(() => {
      const current = activeOperationRef.current;
      if (!current || current.id !== activeOperation.id || !isOperationActive(current)) return;
      void cancelOperation(current, `${current.kind} operation timed out`);
    }, delay);
    return clearOperationDeadline;
  }, [activeOperation, cancelOperation, clearOperationDeadline]);

  const armTurnWatchdog = useCallback((turn: CodexTurn | null | undefined) => {
    clearTurnWatchdog();
    if (!turn || turn.status !== "running") return;
    turnWatchdogRef.current = globalThis.setTimeout(() => {
      const currentTurn = activeTurnRef.current;
      if (!currentTurn || currentTurn.id !== turn.id || currentTurn.status !== "running") return;
      const waitingForUser = itemsRef.current.some((item) => (
        item.turnId === turn.id
        && (item.kind === "approval" || item.kind === "question")
        && item.status === "pending"
      ));
      if (waitingForUser) {
        armTurnWatchdog(currentTurn);
        return;
      }
      const message = `Codex turn had no runtime progress for ${RUNNING_TURN_IDLE_TIMEOUT_MS}ms`;
      const currentOperation = activeOperationRef.current;
      if (currentOperation?.turnId === currentTurn.id) {
        void cancelOperation(currentOperation, message);
        return;
      }
      setStatus("error");
      setError(message);
      setActiveTurn({ ...currentTurn, status: "failed", completedAt: now() });
      setItems((prev) => appendSingleRuntimeErrorItem({
        items: prev,
        thread: threadRef.current,
        activeTurn: currentTurn,
        message,
        source: "watchdog",
        metadata: { recoverable: true, idleTimeoutMs: RUNNING_TURN_IDLE_TIMEOUT_MS },
      }));
    }, RUNNING_TURN_IDLE_TIMEOUT_MS);
  }, [cancelOperation, clearTurnWatchdog]);

  const projection: CodexRuntimeProjection = useMemo(() => buildCodexProjection({
    status,
    thread,
    activeTurn,
    activeOperation,
    items,
    error,
  }), [activeOperation, activeTurn, error, items, status, thread]);

  useEffect(() => {
    localStorage.setItem(CODEX_SESSION_STORAGE_KEY, JSON.stringify({ thread, activeTurn, items }));
  }, [activeTurn, items, thread]);

  const recordRuntimeError = useCallback((message: string, metadata: Record<string, unknown> = {}) => {
    clearTurnWatchdog();
    const currentOperation = activeOperationRef.current;
    if (currentOperation && isOperationActive(currentOperation)) {
      finishOperation(currentOperation.id, "failed", message);
    }
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
  }, [clearTurnWatchdog, finishOperation]);

  useEffect(() => () => {
    clearTurnWatchdog();
    clearOperationDeadline();
  }, [clearOperationDeadline, clearTurnWatchdog]);

  useEffect(() => {
    if (!isTauri()) return;
    return agentRuntimePort.subscribe((event) => {
      if (event.type === "item") {
        const currentTurn = activeTurnRef.current;
        const payloadTurnId = event.payload.turnId || ("item" in event.payload ? event.payload.item?.turnId : undefined);
        const payloadThreadId = event.payload.threadId || ("item" in event.payload ? event.payload.item?.threadId : undefined);
        const payloadOperationId = "operationId" in event.payload ? event.payload.operationId : undefined;
        const payloadConnectionId = "connectionId" in event.payload ? event.payload.connectionId : undefined;
        const currentOperation = activeOperationRef.current;
        if (!codexRuntimeEventBelongsToActiveScope({
          payloadOperationId,
          payloadConnectionId,
          payloadTurnId,
          payloadThreadId,
          activeOperation: currentOperation,
          activeTurn: currentTurn,
        })) {
          recordStaleRuntimeEvent();
          return;
        }
        if (payloadTurnId && ignoredTurnIdsRef.current.has(payloadTurnId)) return;
        setItems((prev) => applyCodexItemEvent(prev, event.payload));
        if (currentOperation && (!payloadTurnId || payloadTurnId === currentOperation.turnId)) {
          patchOperation(currentOperation.id, {
            status: "running",
            lastEventAt: now(),
            deadlineAt: operationDeadlineFromNow(codexOperationIdleTimeoutMs(
              currentOperation.kind === "plan" ? "direct-deepseek-plan" : "codex-app-server-build",
            )),
          });
        }
        if (currentTurn?.status === "running" && (!payloadTurnId || payloadTurnId === currentTurn.id)) {
          armTurnWatchdog(currentTurn);
        }
        return;
      }
      if (event.type === "turn") {
        if (ignoredTurnIdsRef.current.has(event.payload.id)) return;
        const currentOperation = activeOperationRef.current;
        if (!codexRuntimeEventBelongsToActiveScope({
          payloadOperationId: event.payload.operationId,
          payloadConnectionId: event.payload.connectionId,
          payloadTurnId: event.payload.id,
          payloadThreadId: event.payload.threadId,
          activeOperation: currentOperation,
          activeTurn: activeTurnRef.current,
        })) {
          recordStaleRuntimeEvent();
          return;
        }
        setActiveTurn(event.payload);
        setStatus(event.payload.status === "running" ? "running" : event.payload.status === "failed" ? "error" : "ready");
        if (currentOperation && (!currentOperation.turnId || currentOperation.turnId === event.payload.id)) {
          patchOperation(currentOperation.id, {
            turnId: event.payload.id,
            threadId: event.payload.threadId,
            status: event.payload.status === "running" ? "running" : event.payload.status === "failed" ? "failed" : "completed",
            finalState: event.payload.status === "running" ? undefined : event.payload.status === "failed" ? "failed" : "completed",
            lastEventAt: now(),
            deadlineAt: event.payload.status === "running"
              ? operationDeadlineFromNow(codexOperationIdleTimeoutMs(
                currentOperation.kind === "plan" ? "direct-deepseek-plan" : "codex-app-server-build",
              ))
              : currentOperation.deadlineAt,
          });
        }
        if (event.payload.status === "running") {
          armTurnWatchdog(event.payload);
        } else {
          clearTurnWatchdog();
        }
        return;
      }
      if (event.type === "status") {
        const currentOperation = activeOperationRef.current;
        if (!codexRuntimeEventBelongsToActiveScope({
          payloadOperationId: event.payload.operationId,
          payloadConnectionId: event.payload.connectionId,
          activeOperation: currentOperation,
          activeTurn: activeTurnRef.current,
        })) {
          recordStaleRuntimeEvent();
          return;
        }
        if (event.payload.sidecarStatus) {
          setSidecarStatus(event.payload.sidecarStatus);
        }
        if (event.payload.operationId) {
          const finalState = event.payload.status === "error" ? "failed" : event.payload.status === "ready" ? "completed" : undefined;
          if (finalState) {
            finishOperation(event.payload.operationId, finalState, event.payload.error);
          } else {
            patchOperation(event.payload.operationId, { status: "running", lastEventAt: now() });
          }
        }
        if (event.payload.operationKind === "restart" && event.payload.status === "error") {
          setStatus(event.payload.sidecarStatus?.running ? "ready" : "error");
        } else {
          setStatus(event.payload.status);
        }
        setError(event.payload.error);
        if (codexStatusEventShouldCreateTimelineError(event.payload)) {
          recordRuntimeError(event.payload.error || "Codex runtime error", { source: "status" });
        }
        if (isDesktopRuntime()) {
          void agentRuntimePort.diagnostics().then(setDiagnostics).catch(() => undefined);
        }
        return;
      }
      recordRuntimeError(event.payload.message, { source: "event" });
    });
  }, [armTurnWatchdog, clearTurnWatchdog, finishOperation, patchOperation, recordRuntimeError, recordStaleRuntimeEvent]);

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
    void agentRuntimePort.diagnostics()
      .then(setDiagnostics)
      .catch(() => undefined);
  }, []);

  const runtimeSettings: CodexRuntimeSettingsModel = useMemo(() => ({
    sidecarStatus,
    sidecarInfo,
    sidecarPath: sidecarInfo?.path,
    bridgeStatus: activeOperation?.kind === "restart" && isOperationActive(activeOperation)
      ? "starting"
      : status === "starting" ? "starting" : sidecarStatus.running ? "ready" : sidecarStatus.lastError ? "error" : "stopped",
    bridgeBaseUrl: sidecarStatus.bridgeBaseUrl,
    activeProvider: undefined,
    lastError: sidecarStatus.lastError,
    latestDesktopBuildSmoke: desktopBuildSmokeReport,
    diagnostics: diagnostics ? { ...diagnostics, staleEventCount } : diagnostics,
  }), [activeOperation, desktopBuildSmokeReport, diagnostics, sidecarInfo, sidecarStatus, staleEventCount, status]);

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
    baseUrl?: string;
    threadId?: string;
    reasoningEffort?: ReasoningEffort;
    buildBlockedReason?: string;
  }) => {
    if (codexComposerSubmitLocked(statusRef.current, activeTurnRef.current, activeOperationRef.current)) {
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

    const operation = beginOperation({
      kind: input.mode === "build" ? "build" : "plan",
      timeoutMs: codexOperationIdleTimeoutMs(runtimeMode),
      threadId: activeThread.id,
    });
    setStatus(input.mode === "build" ? "starting" : "running");
    try {
      const result = await withTimeout(agentRuntimePort.startTurn({
        threadId: activeThread.id,
        workspacePath: input.workspacePath,
        prompt: input.prompt,
        mode: input.mode,
        runtimeMode,
        providerId: input.providerId,
        model: input.model,
        baseUrl: input.baseUrl,
        reasoningEffort: input.reasoningEffort,
        operationId: operation.id,
      }), codexTurnStartTimeoutMs(runtimeMode), `${runtimeMode} turn/start`);
      patchOperation(operation.id, {
        status: result.turn.status === "running" ? "running" : result.turn.status === "failed" ? "failed" : "completed",
        turnId: result.turn.id,
        threadId: result.turn.threadId,
        lastEventAt: now(),
        deadlineAt: result.turn.status === "running"
          ? operationDeadlineFromNow(codexOperationIdleTimeoutMs(runtimeMode))
          : operation.deadlineAt,
        finalState: result.turn.status === "running" ? undefined : result.turn.status === "failed" ? "failed" : "completed",
      });
      const latestOperation = activeOperationRef.current;
      const resultArrivedAfterTerminalEvent = latestOperation?.id === operation.id
        && !isOperationActive(latestOperation)
        && result.turn.status === "running";
      setActiveTurn((current) => {
        if (resultArrivedAfterTerminalEvent && current && current.status !== "running") return current;
        return result.turn;
      });
      setItems((prev) => applyCodexItemEvents(prev, result.items));
      setStatus(resultArrivedAfterTerminalEvent ? "ready" : result.turn.status === "failed" ? "error" : result.turn.status === "running" ? "running" : "ready");
      if (result.turn.status === "running" && !resultArrivedAfterTerminalEvent) {
        armTurnWatchdog(result.turn);
      } else {
        clearTurnWatchdog();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clearTurnWatchdog();
      await cancelOperation(operation, message);
      failWithSingleRuntimeError(message);
    }
  }, [armTurnWatchdog, beginOperation, cancelOperation, clearTurnWatchdog, ensureThread, patchOperation]);

  const interrupt = useCallback(async () => {
    const currentOperation = activeOperationRef.current;
    if (currentOperation && isOperationActive(currentOperation)) {
      await cancelOperation(currentOperation, "Operation interrupted by user");
    }
    if (!activeTurn || !thread) return;
    try {
      await agentRuntimePort.interruptTurn(thread.id, activeTurn.id);
    } finally {
      setActiveTurn((prev) => prev ? { ...prev, status: "interrupted", completedAt: now() } : prev);
      setStatus("ready");
    }
  }, [activeTurn, cancelOperation, thread]);

  const resolveAction = useCallback(async (action: ActionRequiredEvent, approved: boolean, answer?: string) => {
    const knownTarget = items.find((item) => item.id === action.id);
    const fixtureAction = typeof knownTarget?.metadata?.flow === "string";
    if (isDesktopRuntime() && !fixtureAction) {
      try {
        await agentRuntimePort.submitApproval(action.id, approved, answer);
      } catch (err) {
        const failure = codexActionSubmitFailure({ action, approved, error: err });
        setStatus("error");
        setError(failure.message);
        setItems((prev) => appendSingleRuntimeErrorItem({
          items: prev,
          thread: threadRef.current,
          activeTurn: activeTurnRef.current,
          message: failure.message,
          source: "approval-submit",
          metadata: failure.metadata,
        }));
        void agentRuntimePort.diagnostics().then(setDiagnostics).catch(() => undefined);
      }
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
    clearTurnWatchdog();
    clearOperationDeadline();
    setThread(null);
    setActiveTurn(null);
    setActiveOperation(null);
    setItems([]);
    setError(undefined);
    setStatus("stopped");
    localStorage.removeItem(CODEX_SESSION_STORAGE_KEY);
  }, [clearOperationDeadline, clearTurnWatchdog]);

  const recoverRuntime = useCallback(async (reason = "Recovered stuck runtime state") => {
    clearTurnWatchdog();
    clearOperationDeadline();
    const recovered = recoverCodexRuntimeState({
      thread: threadRef.current,
      activeTurn: activeTurnRef.current,
      activeOperation: activeOperationRef.current,
      reason,
    });
    activeOperationRef.current = recovered.activeOperation;
    activeTurnRef.current = recovered.activeTurn;
    setActiveOperation(recovered.activeOperation);
    setActiveTurn(recovered.activeTurn);
    setStatus(recovered.status);
    setError(undefined);
    if (isDesktopRuntime()) {
      await agentRuntimePort.recoverRuntime()
        .then(setDiagnostics)
        .catch(() => undefined);
    }
  }, [clearOperationDeadline, clearTurnWatchdog]);

  const freezeDiagnosticsReport = useCallback((): FreezeDiagnosticReport => {
    let localStorageSession: FreezeDiagnosticReport["localStorageSession"];
    try {
      const raw = localStorage.getItem(CODEX_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { thread?: unknown; activeTurn?: CodexTurn | null; items?: unknown[] };
        localStorageSession = {
          hasThread: Boolean(parsed.thread),
          activeTurnStatus: parsed.activeTurn?.status,
          itemCount: Array.isArray(parsed.items) ? parsed.items.length : 0,
        };
      }
    } catch {
      localStorageSession = undefined;
    }
    const activeItems = itemsRef.current;
    const activeActions = activeItems.filter((item) => (
      (item.kind === "approval" || item.kind === "question") && item.status === "pending"
    ));
    return {
      generatedAt: now(),
      status: statusRef.current,
      composerLocked: codexComposerSubmitLocked(statusRef.current, activeTurnRef.current, activeOperationRef.current),
      composerLockReason: codexComposerLockReason(statusRef.current, activeTurnRef.current, activeOperationRef.current),
      activeTurn: activeTurnRef.current,
      activeOperation: activeOperationRef.current,
      runtimeDiagnostics: diagnostics ? { ...diagnostics, staleEventCount: staleEventCountRef.current } : diagnostics,
      itemCount: activeItems.length,
      runningItemCount: activeItems.filter((item) => item.status === "running").length,
      pendingActionCount: activeActions.length,
      localStorageSession,
    };
  }, [diagnostics]);

  const restartRuntime = useCallback(async (providerId = "deepseek") => {
    if (restartInFlightRef.current) return restartInFlightRef.current;
    const currentOperation = activeOperationRef.current;
    if (currentOperation?.kind === "restart" && isOperationActive(currentOperation)) {
      return {
        status: sidecarStatus,
        pid: sidecarStatus.pid,
        error: undefined,
      } satisfies RuntimeRestartResult;
    }
    const operation = beginOperation({
      kind: "restart",
      timeoutMs: CODEX_RUNTIME_RESTART_TIMEOUT_MS,
    });
    const restart = (async () => {
      try {
        const result = await withTimeout(
          agentRuntimePort.restart(providerId, operation.id),
          3_000,
          "Codex runtime restart enqueue",
        );
        setSidecarStatus(result.status);
        setError(result.error || undefined);
        finishOperation(operation.id, result.error ? "failed" : "completed", result.error);
        setStatus(result.status.running ? "ready" : "ready");
        void agentRuntimePort.sidecarInfo()
          .then(setSidecarInfo)
          .catch(() => undefined);
        void agentRuntimePort.diagnostics()
          .then(setDiagnostics)
          .catch(() => undefined);
        return result;
      } catch (err) {
        const result = codexRuntimeRestartFailureResult(err);
        await cancelOperation(operation, result.error || "Codex runtime restart failed");
        const latestStatus = await withTimeout(
          agentRuntimePort.status(),
          1_500,
          "Codex runtime status after restart failure",
        ).catch(() => result.status);
        const resolved: RuntimeRestartResult = {
          ...result,
          status: latestStatus,
          error: latestStatus.running ? latestStatus.lastError : result.error,
        };
        setSidecarStatus(resolved.status);
        setError(resolved.error || resolved.status.lastError);
        setStatus("ready");
        finishOperation(operation.id, resolved.status.running ? "completed" : "failed", resolved.error || resolved.status.lastError);
        return resolved;
      }
    })().finally(() => {
      restartInFlightRef.current = null;
    });
    restartInFlightRef.current = restart;
    return restart;
  }, [beginOperation, cancelOperation, finishOperation, sidecarStatus]);

  return {
    status,
    thread,
    activeTurn,
    activeOperation,
    items,
    projection,
    runtimeSettings,
    submit,
    interrupt,
    resolveAction,
    restartRuntime,
    recoverRuntime,
    freezeDiagnosticsReport,
    clear,
  };
}
