import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "../domain/agentEvents";
import type { AgentRunSession } from "../domain/agentRunSession";
import { createQuestionRequest, formatQuestionAnswer, type QuestionAnswerInput, type QuestionRequest } from "../domain/questionRequest";
import type { TerminalRun } from "../domain/terminalRun";
import type { ToolCallLifecycle } from "../domain/toolCallLifecycle";
import { createThreadEvent, type CreateThreadEventInput, type ThreadEvent } from "../domain/threadEvents";
import { serializeThreadEvents } from "../domain/threadEvents";
import {
  createActionRequiredEvent,
  type ActionRequiredEvent,
} from "../domain/actionRequired";
import type { ToolParams } from "../domain/agentLoop";
import type { PermissionAction, PermissionDecision, PermissionPreset, ProjectSecurityOverride } from "../domain/types";
import { selectRunSteps } from "../domain/runSteps";
import { selectPendingActions } from "../domain/threadEventSelectors";
import { sessionStore } from "../storage/sessionStore";
import { callLLMApi, CODER_SYSTEM_PROMPT, type LLMProvider } from "../services/llmService";
import { parseCodingPlan } from "../domain/planSchema";
import { useSession } from "./useSession";
import { useFileSystem } from "./useFileSystem";
import { useEmbeddingIndex } from "./useEmbeddingIndex";
import { useWindowActions } from "./useWindowActions";
import { useProjectStore } from "./useProjectStore";
import { usePatchWorkflow } from "./usePatchWorkflow";
import { useAgentRun } from "./useAgentRun";
import { useRunControls } from "./useRunControls";
import { useLayoutPreferences } from "./useLayoutPreferences";
import { useProjectActions } from "./useProjectActions";
import { useThreadUiState } from "./useThreadUiState";
import { useActionRequiredController } from "./actionRequiredController";
import type { ImportedPlanState } from "./useSession";
import { formatCommandForDisplay } from "../runtime/commandParser";
import { selectVerificationCommand } from "../runtime/verificationCommand";
import { buildEffectiveSecurityPolicy } from "../runtime/securityPolicy";
import { ContextProviderRegistry, type ContextInspectorModel } from "../runtime/contextProviders";
import { PermissionScheduler } from "../runtime/permissionScheduler";
import { invokeDesktop } from "../runtime/desktopGateway";
import { buildUsageSnapshot } from "./usageSnapshot";
import { buildReviewDockModel } from "../features/review/reviewDockModel";
import { approvalGrantKey, persistableApprovalGrants, recoverApprovalGrants, type ApprovalGrant } from "../domain/approvalGrant";
import type { ApprovalRequest } from "./useApprovalQueue";
import { isTauri } from "../utils/tauri";
import { findProvider } from "../providers/providerRegistry";
import { runPlannerTurn, summarizePlanDraft } from "./plannerEngine";
import {
  restoreThreadEventStore,
} from "./threadEventStore";
import {
  RuntimeLedger,
  runtimeLedgerReducer,
  type CheckpointRuntimeSnapshot,
  type ThreadRuntimeSnapshot,
} from "./threadRuntimeStore";
import { createDeepSeekSmokeRunRecord, type SmokeRunRecord } from "../runtime/deepSeekSmokeHarness";
import { buildSessionBrowserModel } from "../domain/sessionBrowser";
import { inferPermissionActions } from "../runtime/policyEngine";
import { ResumeController } from "./resumeController";
import { CheckpointRestoreController } from "./checkpointRestoreController";
import { SessionRestoreController } from "./sessionRestoreController";

export type { AgentEvent } from "../domain/agentEvents";
export type { ImportedPlanState, ImportErrorState, ProviderSettings } from "./useSession";

const THREAD_SNAPSHOTS_KEY = "orbit-code.thread-snapshots.v1";

function emptyContextInspector(mode: "plan" | "build" = "plan"): ContextInspectorModel {
  return {
    blocks: [],
    disabledBlocks: [],
    skills: [],
    editableSources: [
      { path: "ORBIT.md", title: "ORBIT.md", source: "workspace", exists: false, content: "" },
      { path: ".orbit/rules", title: ".orbit/rules", source: "project", exists: false, content: "" },
      { path: ".orbit/rules.md", title: ".orbit/rules.md", source: "project", exists: false, content: "" },
    ],
    externalRuleCandidates: [],
    source: "context-provider-registry",
    mode,
    tokenEstimate: 0,
    errors: [],
    matchedRules: [],
    permissionImpact: "none",
    lastCollectedAt: "",
  };
}

interface ThreadSnapshot {
  importedPlan: ImportedPlanState | null;
  agentEvents?: AgentEvent[];
  threadEvents?: ThreadEvent[];
  agentRunSession?: AgentRunSession | null;
  approvalRequests?: ApprovalRequest[];
  approvalGrants?: ApprovalGrant[];
  questionRequests?: QuestionRequest[];
  actionRequired?: ActionRequiredEvent[];
  toolCalls?: ToolCallLifecycle[];
  terminalRuns?: TerminalRun[];
  runtimeLedgerSnapshot?: ThreadRuntimeSnapshot;
  checkpointRuntimeSnapshots?: Record<string, CheckpointRuntimeSnapshot>;
  updatedAt: string;
}

function loadThreadSnapshots(): Record<string, ThreadSnapshot> {
  try {
    const raw = localStorage.getItem(THREAD_SNAPSHOTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ThreadSnapshot>;
  } catch {
    return {};
  }
}

function approvalKindForTool(tool: string): ActionRequiredEvent["kind"] {
  if (tool === "run_command") return "command";
  if (tool === "apply_patch" || tool === "propose_patch") return "write";
  return "command";
}

function migrateLegacyQueuesToActions(input: {
  approvals?: ApprovalRequest[] | null;
  questions?: QuestionRequest[] | null;
  existing?: ActionRequiredEvent[] | null;
}): ActionRequiredEvent[] {
  const actions = [...(input.existing || [])];
  const ids = new Set(actions.map((action) => action.id));
  for (const request of input.approvals || []) {
    if (ids.has(request.id)) continue;
    const action = createActionRequiredEvent({
      id: request.id,
      kind: approvalKindForTool(request.tool),
      tool: request.tool,
      params: request.params,
      workspacePath: request.workspacePath,
      threadId: request.threadId,
      taskId: request.taskId,
      title: request.tool === "run_command" ? "Run command" : `Authorize ${request.tool}`,
      description: request.reason || request.tool,
      reason: request.reason,
      grantScope: request.grantScope,
    });
    actions.push({
      ...action,
      status: request.status === "approved" ? "approved" : request.status,
      resolvedAt: request.resolvedAt,
      toolResultText: request.status === "pending" ? undefined : `Legacy approval ${request.status}: ${request.tool}`,
    });
    ids.add(request.id);
  }
  for (const request of input.questions || []) {
    if (ids.has(request.id)) continue;
    const action = createActionRequiredEvent({
      id: request.id,
      kind: "question",
      question: request.question,
      options: request.options,
      allowFreeform: request.allowFreeform,
      workspacePath: request.workspacePath,
      threadId: request.threadId,
      taskId: request.taskId,
      title: "Question",
      description: request.question,
    });
    actions.push({
      ...action,
      status: request.status === "answered" ? "resolved" : request.status === "cancelled" ? "cancelled" : "pending",
      answer: request.answer,
      resolvedAt: request.resolvedAt,
      toolResultText: request.answer ? `User answered: ${request.answer}` : undefined,
    });
    ids.add(request.id);
  }
  return actions;
}

async function readPackageScripts(workspacePath: string, cwd?: string): Promise<Record<string, string> | undefined> {
  if (!isTauri() || !workspacePath) return undefined;
  const packagePath = cwd ? `${cwd.replace(/\/+$/, "")}/package.json` : "package.json";
  try {
    const raw = await invoke<string>("read_workspace_file", { path: packagePath, workspacePath });
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts;
  } catch {
    return undefined;
  }
}

export function useWorkspace() {
  const session = useSession();

  const [runtimeState, dispatchRuntimeLedger] = useReducer(runtimeLedgerReducer, undefined, () => new RuntimeLedger().snapshot());
  const threadEvents = runtimeState.events;
  const actionRequired = runtimeState.actionRequired;
  const toolCallLifecycles = runtimeState.toolCalls;
  const setThreadEvents = useCallback((next: SetStateAction<ThreadEvent[]>) => {
    dispatchRuntimeLedger({
      type: "setThreadEvents",
      events: typeof next === "function"
        ? (next as (value: ThreadEvent[]) => ThreadEvent[])(threadEventsRef.current)
        : next,
    });
  }, []);
  const setActionRequired = useCallback((next: SetStateAction<ActionRequiredEvent[]>) => {
    dispatchRuntimeLedger({
      type: "setActionRequired",
      actions: typeof next === "function"
        ? (next as (value: ActionRequiredEvent[]) => ActionRequiredEvent[])(actionRequiredRef.current)
        : next,
    });
  }, []);
  const setToolCallLifecycles = useCallback((next: SetStateAction<ToolCallLifecycle[]>) => {
    dispatchRuntimeLedger({
      type: "setToolCalls",
      calls: typeof next === "function"
        ? (next as (value: ToolCallLifecycle[]) => ToolCallLifecycle[])(toolCallLifecyclesRef.current)
        : next,
    });
  }, []);
  const setRuntimeCheckpointSnapshots = useCallback((next: SetStateAction<Record<string, CheckpointRuntimeSnapshot>>) => {
    dispatchRuntimeLedger({
      type: "setCheckpointRuntimeSnapshots",
      snapshots: typeof next === "function"
        ? (next as (value: Record<string, CheckpointRuntimeSnapshot>) => Record<string, CheckpointRuntimeSnapshot>)(runtimeCheckpointSnapshotsRef.current)
        : next,
    });
  }, []);
  const replaceRuntimeLedgerSnapshot = useCallback((snapshot: ThreadRuntimeSnapshot) => {
    dispatchRuntimeLedger({ type: "replace", snapshot });
  }, []);
  const [currentContextInspector, setCurrentContextInspector] = useState<ContextInspectorModel>(() => emptyContextInspector());
  const [healingAttempts, setHealingAttempts] = useState<Record<string, number>>({});

  const threadEventsRef = useRef(threadEvents);
  const isRealLLMActiveRef = useRef(session.isRealLLMActive);
  const activeLLMConfigRef = useRef(session.activeLLMConfig);
  const healingAttemptsRef = useRef(healingAttempts);
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const restoredWaitNoticeRef = useRef(false);
  const restoredInitialSessionEventsRef = useRef(false);
  const restoredRecentWorkspaceRef = useRef(false);
  const markVerificationCompletedForContinueRef = useRef<((taskId: string, exitCode: number | null, outputSnippet?: string, scope?: { workspacePath?: string; threadId?: string }) => void) | null>(null);
  const recoverAgentRunSessionRef = useRef<((session: AgentRunSession | null) => void) | null>(null);
  const recoverTerminalRunsRef = useRef<((runs: TerminalRun[], replace?: boolean) => void) | null>(null);
  const agentRunSessionRef = useRef<AgentRunSession | null>(null);
  const actionRequiredRef = useRef<ActionRequiredEvent[]>([]);
  const terminalRunsRef = useRef<TerminalRun[]>([]);
  const toolCallLifecyclesRef = useRef<ToolCallLifecycle[]>([]);
  const runtimeCheckpointSnapshotsRef = useRef<Record<string, CheckpointRuntimeSnapshot>>({});
  const [approvalGrants, setApprovalGrants] = useState<ApprovalGrant[]>([]);
  const resumeController = useMemo(() => new ResumeController(), []);
  const checkpointRestoreController = useMemo(() => new CheckpointRestoreController(), []);
  const sessionRestoreController = useMemo(() => new SessionRestoreController(resumeController), [resumeController]);

  useEffect(() => { threadEventsRef.current = threadEvents; }, [threadEvents]);
  useEffect(() => { actionRequiredRef.current = actionRequired; }, [actionRequired]);
  useEffect(() => { toolCallLifecyclesRef.current = toolCallLifecycles; }, [toolCallLifecycles]);
  useEffect(() => { runtimeCheckpointSnapshotsRef.current = runtimeState.checkpointRuntimeSnapshots; }, [runtimeState.checkpointRuntimeSnapshots]);
  useEffect(() => { isRealLLMActiveRef.current = session.isRealLLMActive; }, [session.isRealLLMActive]);
  useEffect(() => { activeLLMConfigRef.current = session.activeLLMConfig; }, [session.activeLLMConfig]);
  useEffect(() => { healingAttemptsRef.current = healingAttempts; }, [healingAttempts]);

  const getRuntimeThreadEvents = useCallback(() => threadEventsRef.current, []);
  const getRuntimeActions = useCallback(() => actionRequiredRef.current, []);
  const actionRequiredController = useActionRequiredController({
    getThreadEvents: getRuntimeThreadEvents,
    getActions: getRuntimeActions,
    appendAction: (action) => dispatchRuntimeLedger({ type: "appendActionRequired", action }),
    updateAction: (id, action) => dispatchRuntimeLedger({ type: "updateActionRequired", id, update: action }),
    setActions: (actions) => dispatchRuntimeLedger({ type: "setActionRequired", actions }),
  });

  useEffect(() => {
    return () => {
      timerRef.current.forEach(clearTimeout);
      timerRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (restoredInitialSessionEventsRef.current) return;
    if (session.loadedRuntimeLedgerSnapshot && threadEvents.length === 0 && actionRequired.length === 0 && toolCallLifecycles.length === 0) {
      restoredInitialSessionEventsRef.current = true;
      replaceRuntimeLedgerSnapshot(session.loadedRuntimeLedgerSnapshot);
      return;
    }
    if (session.loadedThreadEvents && session.loadedThreadEvents.length > 0 && threadEvents.length === 0) {
      restoredInitialSessionEventsRef.current = true;
      setThreadEvents(restoreThreadEventStore({ threadEvents: session.loadedThreadEvents }));
      return;
    }
    if (session.loadedAgentEvents && session.loadedAgentEvents.length > 0 && threadEvents.length === 0) {
      restoredInitialSessionEventsRef.current = true;
      setThreadEvents(restoreThreadEventStore({ agentEvents: session.loadedAgentEvents as AgentEvent[] }));
    }
  }, [actionRequired.length, replaceRuntimeLedgerSnapshot, session.loadedAgentEvents, session.loadedRuntimeLedgerSnapshot, session.loadedThreadEvents, threadEvents.length, toolCallLifecycles.length]);

  const emitThreadEvent = useCallback((event: ThreadEvent) => {
    dispatchRuntimeLedger({ type: "appendThreadEvent", event });
  }, []);

  const emitWorkspaceEvent = useCallback((event: CreateThreadEventInput) => {
    dispatchRuntimeLedger({ type: "appendThreadEvent", event: createThreadEvent(event) });
  }, []);

  const updateThreadEvent = useCallback((id: string, update: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent)) => {
    dispatchRuntimeLedger({ type: "updateThreadEvent", id, update });
  }, []);

  const appendPatchReviewAction = useCallback((event: ThreadEvent) => {
    if (!event.patches?.some((patch) => !patch.applied)) return;
    if (actionRequiredRef.current.some((action) => action.sourceEventId === event.id || action.id === `patch-review-${event.id}`)) return;
    dispatchRuntimeLedger({ type: "appendActionRequired", action: createActionRequiredEvent({
      id: `patch-review-${event.id}`,
      kind: "patchReview",
      sourceEventId: event.id,
      workspacePath: event.workspacePath,
      threadId: event.threadId,
      taskId: event.taskId,
      runSessionId: event.runSessionId,
      title: "Patch Review",
      description: event.patches?.map((patch) => patch.path).join(", ") || event.message,
    }) });
  }, []);

  const appendToolCallLifecycle = useCallback((call: ToolCallLifecycle) => {
    dispatchRuntimeLedger({ type: "appendToolCall", call });
  }, []);

  const updateToolCallLifecycle = useCallback((id: string, update: Partial<ToolCallLifecycle> | ((call: ToolCallLifecycle) => ToolCallLifecycle)) => {
    dispatchRuntimeLedger({ type: "updateToolCall", id, update });
  }, []);

  const recoverToolCallLifecycles = useCallback((calls: ToolCallLifecycle[] = [], replace = true) => {
    setToolCallLifecycles((prev) => replace ? calls : [...calls, ...prev]);
  }, [setToolCallLifecycles]);

  const embeddingIndex = useEmbeddingIndex({ onEvent: (event) => emitWorkspaceEvent({
    kind: "agentMessage",
    workspacePath: event.workspacePath,
    threadId: event.threadId,
    taskId: event.taskId,
    runSessionId: event.runSessionId,
    role: event.role,
    status: event.status,
    title: event.name,
    message: event.message,
    createdAt: event.createdAt,
    patches: event.patches,
    question: event.question,
    planDraft: event.planDraft,
  }) });
  const windowActions = useWindowActions();
  const contextProviderRegistry = useMemo(() => new ContextProviderRegistry(), []);
  const permissionScheduler = useMemo(
    () => new PermissionScheduler({ requestAction: actionRequiredController.request }),
    [actionRequiredController.request],
  );
  const projectStore = useProjectStore();
  const layout = useLayoutPreferences();
  const projectActions = useProjectActions(projectStore.recentProjects);
  const runControls = useRunControls(session.providerSettings, session.apiKeys, session.credentialVaultProviders);

  useEffect(() => {
    if (session.loadedApprovalGrants && session.loadedApprovalGrants.length > 0) {
      setApprovalGrants((prev) => persistableApprovalGrants([
        ...recoverApprovalGrants(session.loadedApprovalGrants ?? []),
        ...prev,
      ]));
    }
  }, [session.loadedApprovalGrants]);

  useEffect(() => {
    if (actionRequired.length > 0) return;
    const migrated = migrateLegacyQueuesToActions({
      existing: session.loadedActionRequired,
      approvals: session.loadedApprovalRequests,
      questions: session.loadedQuestionRequests,
    });
    if (migrated.length > 0) {
      setActionRequired(migrated);
    }
  }, [actionRequired.length, session.loadedActionRequired, session.loadedApprovalRequests, session.loadedQuestionRequests]);

  useEffect(() => {
    const pendingPatchEvents = threadEvents.filter((event) =>
      event.patches?.some((patch) => !patch.applied)
    );
    if (pendingPatchEvents.length === 0) return;
    const existingSources = new Set(actionRequired.map((action) => action.sourceEventId).filter(Boolean));
    const missing = pendingPatchEvents.filter((event) => !existingSources.has(event.id));
    if (missing.length === 0) return;
    for (const event of missing) {
      dispatchRuntimeLedger({ type: "appendActionRequired", action: createActionRequiredEvent({
        id: `patch-review-${event.id}`,
        kind: "patchReview",
        sourceEventId: event.id,
        workspacePath: event.workspacePath,
        threadId: event.threadId,
        taskId: event.taskId,
        runSessionId: event.runSessionId,
        title: "Patch Review",
        description: event.patches?.map((patch) => patch.path).join(", ") || event.message,
      }) });
    }
  }, [actionRequired, threadEvents]);

  useEffect(() => {
    const completedPatchActions = actionRequired.filter((action) => {
      if (action.kind !== "patchReview" || action.status !== "pending" || !action.sourceEventId) return false;
      const event = threadEvents.find((item) => item.id === action.sourceEventId);
      return Boolean(event?.patches?.length && event.patches.every((patch) => patch.applied));
    });
    if (completedPatchActions.length === 0) return;
    for (const action of completedPatchActions) {
      dispatchRuntimeLedger({ type: "resolveActionRequired", id: action.id, resolution: {
        status: "approved",
        toolResultText: `Patch review approved and applied for ${action.sourceEventId}.`,
      } });
    }
  }, [actionRequired, threadEvents]);

  useEffect(() => {
    if (session.loadedToolCalls && session.loadedToolCalls.length > 0 && toolCallLifecyclesRef.current.length === 0) {
      recoverToolCallLifecycles(session.loadedToolCalls, true);
    }
  }, [recoverToolCallLifecycles, session.loadedToolCalls]);

  useEffect(() => {
    const snapshots = session.loadedRuntimeLedgerSnapshot?.checkpointRuntimeSnapshots;
    if (!snapshots || Object.keys(snapshots).length === 0) return;
    setRuntimeCheckpointSnapshots((prev) => ({
      ...snapshots,
      ...prev,
    }));
  }, [session.loadedRuntimeLedgerSnapshot?.checkpointRuntimeSnapshots]);

  const startCollaborationFlow = useCallback(async (plan: ImportedPlanState) => {
    const task = plan?.plan.tasks.find(t => t.status !== "done" && t.status !== "verified");
    setThreadEvents(task ? [createThreadEvent({
      id: `ready-${Date.now()}`,
      kind: "plan",
      role: "planner",
      title: "Plan Ready",
      status: "idle",
      message: `计划已导入，当前待处理任务：[${task.title}]。Plan 模式只读规划；切换 Build 后才会启动 Agent、进入授权、提出补丁并等待变更确认。`,
    })] : []);
  }, []);

  useEffect(() => {
    if (session.importedPlan && !session.isLoading && threadEvents.length === 0 && (!session.loadedThreadEvents || session.loadedThreadEvents.length === 0)) {
      startCollaborationFlow(session.importedPlan);
    }
  }, [session.importedPlan?.plan?.title, session.isLoading, session.loadedThreadEvents, startCollaborationFlow, threadEvents.length]);

  const terminalLogsRef = useRef<Record<string, string>>({});

  const triggerSelfHealing = useCallback(async (taskId: string, exitCode: number | null) => {
    if (!session.providerSettings.agent?.autoSelfHeal || !isRealLLMActiveRef.current || !activeLLMConfigRef.current) return;

    const attempt = healingAttemptsRef.current[taskId] || 0;
    if (attempt >= 3) {
      setThreadEvents(prev => prev.map(e => {
        if (e.role === "verifier") {
          return {
            ...e,
            status: "done",
            message: `自愈重试次数已达上限 (3次)。请人工介入检查测试或编译报错。`
          };
        }
        return e;
      }));
      return;
    }

    setHealingAttempts(prev => ({ ...prev, [taskId]: attempt + 1 }));

    const currentEvents = threadEventsRef.current;
    const coderEvent = [...currentEvents].reverse().find(e => e.role === "coder" && e.patches && e.patches.length > 0);
    if (!coderEvent || !coderEvent.patches || coderEvent.patches.length === 0) return;
    const filePath = coderEvent.patches[0].path;
    const lastFailedContent = coderEvent.patches[0].newContent;

    const logs = terminalLogsRef.current[taskId] || "";
    let errorSnippet = logs.split("\n").slice(-25).join("\n") || "未捕获到具体的测试输出错误。";

    let guardAlert = "";
    if (exitCode === 124) {
      guardAlert = "\n\n【性能监控警报】检测到您的测试代码执行超时（超过 10 秒限制），极有可能是由于死循环 (Infinite Loop) 或算法复杂度过高导致进程挂起。请检查 while、for 循环等边界条件，确保循环能安全退出并优化算法性能。";
    } else if (exitCode === 137) {
      guardAlert = "\n\n【资源监控警报】检测到您的测试代码发生了严重的内存泄露 (Memory Leak)，物理内存占用在短时间内暴增超过 50MB。请检查是否存在无限递归、闭包导致的对象未释放、或者大数组无限 Append 的逻辑。";
    }

    setThreadEvents(prev => {
      const next = [...prev];
      const verifierIdx = next.findIndex(e => e.role === "verifier");
      if (verifierIdx !== -1) {
        let statusMessage = `测试运行失败 (Attempt ${attempt + 1}/3)。`;
        if (exitCode === 124) {
          statusMessage += `检测到 10s 执行超时，正分发给 Coder 进行死循环消除与性能自愈...`;
        } else if (exitCode === 137) {
          statusMessage += `检测到物理内存泄漏 (>50MB)，正分发给 Coder 进行垃圾回收与内存自愈...`;
        } else {
          statusMessage += `正在提取报错堆栈并分发给 Coder 进行自愈修复...`;
        }
        next[verifierIdx] = {
          ...next[verifierIdx],
          status: "thinking",
          message: statusMessage
        };
      }

      let coderMessage = `正在分析编译/测试报错，`;
      if (exitCode === 124) {
        coderMessage += `消除 [${filePath}](file://./${filePath}) 中的死循环并优化执行效率...`;
      } else if (exitCode === 137) {
        coderMessage += `重构 [${filePath}](file://./${filePath}) 并解决内存泄露问题...`;
      } else {
        coderMessage += `试图重构 [${filePath}](file://./${filePath}) 并自愈错误...`;
      }

      next.push({
        id: `healing-${Date.now()}`,
        kind: "patchProposal",
        role: "coder",
        title: "Self-Healing Coder",
        status: "thinking",
        message: coderMessage,
        timestamp: new Date().toLocaleTimeString()
      });
      return next;
    });

    try {
      const userPrompt = `文件路径: ${filePath}\n\n当前包含 Bug 的代码内容:\n${lastFailedContent}\n\n单元测试/编译报错日志:\n${errorSnippet}${guardAlert}\n\n请修改上述代码以修复该测试报错。不要提供额外解释，不要用 markdown 包裹，直接输出修改后的完整源码内容。`;

      const repairedContent = await callLLMApi(
        activeLLMConfigRef.current.provider,
        activeLLMConfigRef.current.model,
        CODER_SYSTEM_PROMPT,
        userPrompt,
        activeLLMConfigRef.current.url
      );

      setThreadEvents(prev => {
        const next = [...prev];
        const healIdx = next.findIndex(e => e.id.startsWith("healing-") && e.status === "thinking");
        if (healIdx !== -1) {
          next[healIdx] = {
            ...next[healIdx],
            status: "done",
            message: `自愈代码补丁已成功生成。我已修复了 [${filePath}](file://./${filePath}) 中导致测试失败的逻辑错误。请重新审查新补丁。`,
            patches: [{
              path: filePath,
              oldContent: lastFailedContent,
              newContent: repairedContent,
              applied: false
            }]
          };
        }

        const verifierIdx = next.findIndex(e => e.role === "verifier");
        if (verifierIdx !== -1) {
          next[verifierIdx] = {
            ...next[verifierIdx],
            status: "idle",
            message: `Coder 已送回自愈补丁，等待用户重新应用并校验。`
          };
        }
        return next;
      });
    } catch (err: any) {
      setThreadEvents(prev => {
        const next = [...prev];
        const healIdx = next.findIndex(e => e.id.startsWith("healing-") && e.status === "thinking");
        if (healIdx !== -1) {
          next[healIdx] = {
            ...next[healIdx],
            status: "done",
            message: `自愈推理调用失败: ${err?.message || String(err)}`
          };
        }
        return next;
      });
    }
  }, [session.providerSettings.agent?.autoSelfHeal]);

  const handleCommandComplete = useCallback((taskId: string, exitCode: number | null, run?: TerminalRun) => {
    if (exitCode === 0) {
      setThreadEvents(prev => prev.map(e => {
        if (e.role === "verifier") {
          return {
            ...e,
            status: "done",
            message: `校验通过！验证命令执行成功，返回值 0，代码编译与回归测试正常。`
          };
        }
        return e;
      }));
    } else {
      if (isRealLLMActiveRef.current && session.providerSettings.agent?.autoSelfHeal) {
        const tid6 = setTimeout(() => {
          triggerSelfHealing(taskId, exitCode);
        }, 100);
        timerRef.current.push(tid6);
      } else {
        setThreadEvents(prev => prev.map(e => {
          if (e.role === "verifier") {
            let failMessage = `校验未通过：验证命令运行失败 (exitCode: ${exitCode})。请修改代码或检查指令。`;
            if (exitCode === 124) {
              failMessage = `校验未通过：测试子进程执行超时超过 10 秒，已被 Verifier Guard 强杀！`;
            } else if (exitCode === 137) {
              failMessage = `校验未通过：测试子进程内存增长异常超过 50MB (疑似内存泄漏)，已被 Verifier Guard 强杀！`;
            }
            return {
              ...e,
              status: "done",
              message: failMessage
            };
          }
          return e;
        }));
      }
    }
    const outputSnippet = (terminalLogsRef.current[taskId] || "").split("\n").slice(-40).join("\n");
    markVerificationCompletedForContinueRef.current?.(taskId, exitCode, outputSnippet, {
      workspacePath: run?.workspacePath,
      threadId: run?.threadId,
    });
  }, [triggerSelfHealing]);

  const fs = useFileSystem(session.providerSettings, session.updateTask, handleCommandComplete, session.loadedTerminalRuns || []);
  const threadUi = useThreadUiState(fs.workspaceRoot, "default-thread");
  const [threadSnapshots, setThreadSnapshots] = useState<Record<string, ThreadSnapshot>>(() => loadThreadSnapshots());
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");

  const collectRuntimeContext = useCallback(async () => {
    const readWorkspaceFile = async (path: string) => {
      if (!fs.workspaceRoot) return "";
      return invokeDesktop<string>("read_workspace_file", { path, workspacePath: fs.workspaceRoot });
    };
    const listWorkspaceFiles = async () => {
      if (!fs.workspaceRoot) return [];
      return invokeDesktop<string[]>("list_workspace_files", { workspacePath: fs.workspaceRoot });
    };
    const inspector = await contextProviderRegistry.collectInspector({
      mode: runControls.mode,
      workspacePath: fs.workspaceRoot,
      threadId: threadUi.threadId,
      planSnapshot: session.importedPlan?.plan || null,
      userRules: session.providerSettings.context?.userRules || [],
      readWorkspaceFile,
      listWorkspaceFiles,
    });
    setCurrentContextInspector(inspector);
    for (const error of inspector.errors) {
      emitWorkspaceEvent({
        id: `context-warning-${Date.now()}-${error.providerId}`,
        kind: "error",
        workspacePath: fs.workspaceRoot,
        threadId: threadUi.threadId,
        role: "reviewer",
        title: "Context Provider Warning",
        status: "done",
        message: `上下文来源 ${error.providerId} 读取失败：${error.message}`,
      });
    }
    return ContextProviderRegistry.formatBlocks(inspector.blocks);
  }, [contextProviderRegistry, emitWorkspaceEvent, fs.workspaceRoot, runControls.mode, session.importedPlan?.plan, session.providerSettings.context?.userRules, threadUi.threadId]);

  const refreshCurrentContext = useCallback(async () => {
    await collectRuntimeContext();
  }, [collectRuntimeContext]);

  const evaluateDeepSeekSmokeRun = useCallback((): SmokeRunRecord => {
    return createDeepSeekSmokeRunRecord({
      events: threadEventsRef.current,
      actionRequired: actionRequiredRef.current,
      workspacePath: fs.workspaceRoot || "/Users/zhoujunjie/PersonalProjects/test for orbit/orbit-mini-lab",
      model: runControls.selection.model || session.activeLLMConfig?.model || "deepseek-v4-flash",
      threadId: threadUi.threadId,
      runSessionId: agentRunSessionRef.current?.id || undefined,
    });
  }, [fs.workspaceRoot, runControls.selection.model, session.activeLLMConfig?.model, threadUi.threadId]);

  const writeProjectContextFile = useCallback(async (path: string, content: string) => {
    if (!fs.workspaceRoot) throw new Error("Workspace is required to edit project context.");
    await invokeDesktop("write_workspace_context_file", {
      workspacePath: fs.workspaceRoot,
      path,
      content,
    });
    await fs.refreshFileTree();
    await collectRuntimeContext();
  }, [collectRuntimeContext, fs]);

  const acceptPlanDraft = useCallback((eventId: string) => {
    const event = threadEventsRef.current.find((item) => item.id === eventId);
    if (!event?.planDraft) return;
    const importedPlan = {
      plan: event.planDraft,
      fileName: "planner-draft.json",
      importedAt: new Date().toISOString(),
    };
    session.restoreImportedPlan(importedPlan);
    runControls.setMode("build");
    emitWorkspaceEvent({
      id: `mode-switch-${Date.now()}`,
      kind: "modeSwitch",
      workspacePath: fs.workspaceRoot,
      threadId: threadUi.threadId,
      role: "planner",
      title: "Mode Switch",
      status: "done",
      message: "已采纳 Plan 草案并切换到 Build。后续命令、补丁和验证都会走中心授权确认。",
      modeSwitch: { from: "plan", to: "build", reason: "accepted_plan_draft" },
    });
    emitWorkspaceEvent({
      id: `todo-list-${Date.now()}`,
      kind: "todoList",
      workspacePath: fs.workspaceRoot,
      threadId: threadUi.threadId,
      role: "planner",
      title: "Todo List",
      status: "active",
      message: `已从 Plan 草案生成 ${event.planDraft.tasks.length} 个 Build 任务。`,
      todoList: {
        source: "plan",
        items: event.planDraft.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status === "done" || task.status === "verified"
            ? "completed"
            : task.status === "running"
              ? "inProgress"
              : task.status === "blocked" || task.status === "review"
                ? "blocked"
                : "pending",
          evidenceEventIds: [eventId],
        })),
      },
    });
  }, [emitWorkspaceEvent, fs.workspaceRoot, runControls, session, threadUi.threadId]);

  const submitPlanMessage = useCallback(async (source: string) => {
    const trimmed = source.trim();
    if (!trimmed) return false;

    const parsedPlan = parseCodingPlan(trimmed);
    if (parsedPlan.ok) {
      return session.importPlan(trimmed, "composer-input.md");
    }

    emitWorkspaceEvent({
      id: `plan-user-${Date.now()}`,
      kind: "userMessage",
      workspacePath: fs.workspaceRoot,
      threadId: threadUi.threadId,
      role: "planner",
      title: "User Instruction",
      status: "done",
      message: trimmed,
    });

    const providerId = runControls.selection.providerId;
    const provider = findProvider(providerId);
    const model = runControls.selection.model.trim();
    if (!model) {
      emitWorkspaceEvent({
        id: `plan-guard-${Date.now()}`,
        kind: "error",
        workspacePath: fs.workspaceRoot,
        threadId: threadUi.threadId,
        role: "planner",
        title: "Run Guard",
        status: "done",
        message: "当前没有可用模型。Plan 自然语言请求需要先导入或配置一个模型；不会回退生成假计划。",
      });
      return false;
    }
    if (runControls.missingCredential) {
      emitWorkspaceEvent({
        id: `plan-guard-${Date.now()}`,
        kind: "error",
        workspacePath: fs.workspaceRoot,
        threadId: threadUi.threadId,
        role: "planner",
        title: "Run Guard",
        status: "done",
        message: "已检测到导入过的模型，但凭据库当前未解锁。请先解锁 API Key 后再使用只读 Planner。",
      });
      return false;
    }
    if (!provider || (!provider.capabilities.local && !session.apiKeys[providerId])) {
      emitWorkspaceEvent({
        id: `plan-guard-${Date.now()}`,
        kind: "error",
        workspacePath: fs.workspaceRoot,
        threadId: threadUi.threadId,
        role: "planner",
        title: "Run Guard",
        status: "done",
        message: "当前模型未接入或缺少 API Key。Plan 模式不会导入自然语言为假计划。",
      });
      return false;
    }

    try {
      const config = session.providerSettings.configs[providerId] || {};
      const runtimeContext = await collectRuntimeContext();
      const result = await runPlannerTurn({
        providerId: providerId as LLMProvider,
        model,
        baseUrl: config.baseUrl || provider.baseUrl,
        reasoningEffort: runControls.selection.reasoningEffort,
        request: [runtimeContext, trimmed].filter(Boolean).join("\n\n---\n\n"),
        workspacePath: fs.workspaceRoot,
        onToolDeniedByMode: (tool) => emitWorkspaceEvent({
          id: `plan-mode-denied-${Date.now()}`,
          kind: "toolDeniedByMode",
          workspacePath: fs.workspaceRoot,
          threadId: threadUi.threadId,
          role: "reviewer",
          title: "Tool Denied By Mode",
          status: "done",
          message: `Plan 模式拒绝了工具 ${tool}。Plan 只能读取、搜索、提问和输出计划。`,
          toolDeniedByMode: {
            tool,
            mode: "plan",
            reason: "Plan mode is read-only.",
          },
        }),
      });
      if (result.kind !== "planDraft") {
        throw new Error(result.message || "Planner did not return a plan draft.");
      }
      const planDraft = result.plan;
      emitWorkspaceEvent({
        id: `plan-draft-${Date.now()}`,
        kind: "planDraft",
        workspacePath: fs.workspaceRoot,
        threadId: threadUi.threadId,
        role: "planner",
        title: "Plan Draft",
        status: "done",
        message: summarizePlanDraft(planDraft),
        planDraft,
      });
      return true;
    } catch (error) {
      emitWorkspaceEvent({
        id: `plan-error-${Date.now()}`,
        kind: "error",
        workspacePath: fs.workspaceRoot,
        threadId: threadUi.threadId,
        role: "planner",
        title: "Agent Error",
        status: "done",
        message: `只读 Planner 生成失败：${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
  }, [collectRuntimeContext, emitWorkspaceEvent, fs.workspaceRoot, runControls, session, threadUi.threadId]);

  useEffect(() => {
    const title = session.importedPlan?.plan.title?.trim();
    if (!title || threadUi.threadUiState.title) return;
    threadUi.updateThreadUiState({ title });
  }, [session.importedPlan?.plan.title, threadUi.threadUiState.title, threadUi.updateThreadUiState]);

  useEffect(() => {
    localStorage.setItem(THREAD_SNAPSHOTS_KEY, JSON.stringify(threadSnapshots));
  }, [threadSnapshots]);

  const cancelRuntimeActionsByKind = useCallback((kind: "question" | "approval" | "all" = "all") => {
    const pending = actionRequiredRef.current.filter((action) => {
      if (action.status !== "pending") return false;
      if (kind === "all") return true;
      if (kind === "question") return action.kind === "question";
      return action.kind !== "question";
    });
    for (const action of pending) {
      actionRequiredController.cancel(action.id);
    }
  }, [actionRequiredController]);

  const persistCurrentThreadSnapshot = useCallback((threadId = threadUi.threadId) => {
    if (!threadId) return;
    setThreadSnapshots((prev) => ({
      ...prev,
      [threadId]: {
        importedPlan: session.importedPlan,
        runtimeLedgerSnapshot: new RuntimeLedger({
          threadEvents: serializeThreadEvents(threadEventsRef.current),
          actionRequired: actionRequiredRef.current,
          toolCalls: toolCallLifecyclesRef.current,
          terminalRuns: terminalRunsRef.current,
          checkpointRuntimeSnapshots: runtimeState.checkpointRuntimeSnapshots,
        }).serializeSnapshot(),
        agentRunSession: agentRunSessionRef.current,
        approvalGrants: persistableApprovalGrants(approvalGrants),
        updatedAt: new Date().toISOString(),
      },
    }));
  }, [approvalGrants, runtimeState.checkpointRuntimeSnapshots, session.importedPlan, threadUi.threadId]);

  const restoreThreadSnapshot = useCallback((threadId: string) => {
    const snapshot = threadSnapshots[threadId];
    const runtimeSnapshot = snapshot?.runtimeLedgerSnapshot;
    const restoredSession = sessionRestoreController.restore({
      runtimeLedgerSnapshot: runtimeSnapshot,
      agentRunSession: snapshot?.agentRunSession ?? null,
      threadEvents: snapshot?.threadEvents,
      actionRequired: snapshot?.actionRequired,
      terminalRuns: snapshot?.terminalRuns,
    });
    cancelRuntimeActionsByKind("all");
    session.restoreImportedPlan(snapshot?.importedPlan ?? null);
    setThreadEvents(restoreThreadEventStore({
      threadEvents: restoredSession.ledger.threadEvents.length > 0 ? restoredSession.ledger.threadEvents : snapshot?.threadEvents,
      agentEvents: snapshot?.agentEvents,
    }));
    setActionRequired(migrateLegacyQueuesToActions({
      existing: restoredSession.ledger.actionRequired.length > 0 ? restoredSession.ledger.actionRequired : snapshot?.actionRequired || [],
      approvals: snapshot?.approvalRequests,
      questions: snapshot?.questionRequests,
    }));
    setApprovalGrants((prev) => persistableApprovalGrants([
      ...prev.filter((grant) => grant.scope === "project"),
      ...(snapshot?.approvalGrants ?? []),
    ]));
    recoverTerminalRunsRef.current?.(restoredSession.ledger.terminalRuns.length > 0 ? restoredSession.ledger.terminalRuns : snapshot?.terminalRuns || [], true);
    recoverToolCallLifecycles(restoredSession.ledger.toolCalls.length > 0 ? restoredSession.ledger.toolCalls : snapshot?.toolCalls || [], true);
    setRuntimeCheckpointSnapshots(runtimeSnapshot?.checkpointRuntimeSnapshots || snapshot?.checkpointRuntimeSnapshots || {});
    recoverAgentRunSessionRef.current?.(snapshot?.agentRunSession ?? null);
  }, [cancelRuntimeActionsByKind, recoverToolCallLifecycles, session, sessionRestoreController, threadSnapshots]);

  const createThread = useCallback(() => {
    persistCurrentThreadSnapshot();
    const nextThreadId = threadUi.createThread();
    cancelRuntimeActionsByKind("all");
    setApprovalGrants((prev) => prev.filter((grant) => grant.scope === "project"));
    setActionRequired([]);
    recoverToolCallLifecycles([], true);
    recoverTerminalRunsRef.current?.([], true);
    recoverAgentRunSessionRef.current?.(null);
    session.restoreImportedPlan(null);
    setThreadEvents([]);
    setRuntimeCheckpointSnapshots({});
    return nextThreadId;
  }, [cancelRuntimeActionsByKind, persistCurrentThreadSnapshot, recoverToolCallLifecycles, session, threadUi]);

  const switchThread = useCallback((nextThreadId: string) => {
    if (!nextThreadId || nextThreadId === threadUi.threadId) return;
    persistCurrentThreadSnapshot();
    threadUi.switchThread(nextThreadId);
    restoreThreadSnapshot(nextThreadId);
  }, [persistCurrentThreadSnapshot, restoreThreadSnapshot, threadUi]);

  const restoreArchivedThreadById = useCallback((targetThreadId: string) => {
    if (!targetThreadId) return;
    threadUi.archiveThreadById(targetThreadId, false);
    switchThread(targetThreadId);
  }, [switchThread, threadUi]);

  const openFallbackThread = useCallback((removedThreadId: string) => {
    const fallback = threadUi.threadList.find((thread) => thread.threadId !== removedThreadId);
    if (fallback) {
      threadUi.switchThread(fallback.threadId);
      restoreThreadSnapshot(fallback.threadId);
      return;
    }
    const nextThreadId = threadUi.createThread();
    restoreThreadSnapshot(nextThreadId);
  }, [restoreThreadSnapshot, threadUi]);

  const togglePinnedThreadById = useCallback((targetThreadId: string) => {
    threadUi.togglePinnedThreadById(targetThreadId);
  }, [threadUi]);

  const renameThreadById = useCallback((targetThreadId: string, title: string) => {
    threadUi.renameThreadById(targetThreadId, title);
  }, [threadUi]);

  const archiveThreadById = useCallback((targetThreadId: string, archived = true) => {
    if (!targetThreadId) return;
    const isActiveThread = targetThreadId === threadUi.threadId;
    if (isActiveThread) persistCurrentThreadSnapshot(targetThreadId);
    threadUi.archiveThreadById(targetThreadId, archived);
    if (isActiveThread && archived) {
      openFallbackThread(targetThreadId);
    }
  }, [openFallbackThread, persistCurrentThreadSnapshot, threadUi]);

  const deleteThreadById = useCallback((targetThreadId: string) => {
    if (!targetThreadId) return;
    const isActiveThread = targetThreadId === threadUi.threadId;
    setThreadSnapshots((prev) => {
      const next = { ...prev };
      delete next[targetThreadId];
      return next;
    });
    threadUi.deleteThread(targetThreadId);
    if (isActiveThread) {
      openFallbackThread(targetThreadId);
    }
  }, [openFallbackThread, threadUi]);

  useEffect(() => {
    const resumeKind = session.loadedAgentRunSession?.resumeKind;
    if (!resumeKind || restoredWaitNoticeRef.current) return;
    const existingEvents = threadEventsRef.current;
    const alreadyNoted = existingEvents.some((event) =>
      event.title === "Recovered Waiting State" && event.message.includes(`：${resumeKind}`)
    );
    if (alreadyNoted) {
      restoredWaitNoticeRef.current = true;
      return;
    }
    restoredWaitNoticeRef.current = true;
    emitWorkspaceEvent({
      id: `resume-${Date.now()}`,
      kind: "commandExecution",
      role: "reviewer",
      title: "Recovered Waiting State",
      status: "idle",
      message: `已恢复等待操作：${resumeKind}。请从中心待处理操作继续。`,
    });
  }, [emitWorkspaceEvent, session.loadedAgentRunSession?.resumeKind]);

  const projectSecurityOverride = useMemo(() => {
    if (!fs.workspaceRoot) return undefined;
    return session.providerSettings.projectSecurityOverrides?.[fs.workspaceRoot];
  }, [fs.workspaceRoot, session.providerSettings.projectSecurityOverrides]);

  const effectiveSecurityPolicy = useMemo(
    () => buildEffectiveSecurityPolicy(session.providerSettings.security, projectSecurityOverride),
    [projectSecurityOverride, session.providerSettings.security],
  );

  const updateProjectSecurityOverride = useCallback(async (updates: {
    preset?: PermissionPreset;
    advancedRules?: Partial<Record<PermissionAction, PermissionDecision>>;
  }) => {
    if (!fs.workspaceRoot) return;
    const current = session.providerSettings.projectSecurityOverrides?.[fs.workspaceRoot];
    const nextOverride: ProjectSecurityOverride = {
      workspacePath: fs.workspaceRoot,
      preset: updates.preset ?? current?.preset,
      advancedRules: updates.advancedRules ?? current?.advancedRules,
      updatedAt: new Date().toISOString(),
    };
    await session.updateProviderSettings({
      ...session.providerSettings,
      projectSecurityOverrides: {
        ...(session.providerSettings.projectSecurityOverrides || {}),
        [fs.workspaceRoot]: nextOverride,
      },
    });
  }, [fs.workspaceRoot, session]);

  useEffect(() => { terminalLogsRef.current = fs.terminalLogs; }, [fs.terminalLogs]);

  const setWorkspaceRoot = useCallback(async (path: string) => {
    persistCurrentThreadSnapshot();
    const ok = await fs.setWorkspaceRoot(path);
    if (ok) {
      await projectStore.rememberProject(path);
    }
    return ok;
  }, [fs, persistCurrentThreadSnapshot, projectStore]);

  const requestRuntimePermission = useCallback((
    tool: string,
    params: ToolParams,
    reason = "",
    onCreated?: (request: ApprovalRequest) => void,
  ) => permissionScheduler.request({
    mode: runControls.mode,
    tool,
    params,
    workspacePath: fs.workspaceRoot,
    threadId: threadUi.threadId,
    taskId: typeof params.taskId === "string" ? params.taskId : undefined,
    runSessionId: agentRunSessionRef.current?.id,
    toolCallId: typeof params.toolCallId === "string" ? params.toolCallId : undefined,
    reason,
    security: session.providerSettings.security,
    projectOverride: projectSecurityOverride,
    approvalGrants,
    onActionCreated: (action) => {
      dispatchRuntimeLedger({ type: "appendActionRequired", action });
    },
    onActionResolved: (action) => {
      dispatchRuntimeLedger({ type: "updateActionRequired", id: action.id, update: action });
    },
    onCreated: (request) => onCreated?.(request),
  }), [
    fs.workspaceRoot,
    permissionScheduler,
    projectSecurityOverride,
    runControls.mode,
    session.providerSettings.security,
    threadUi.threadId,
    approvalGrants,
  ]);

  const requestRuntimeQuestion = useCallback((
    question: string,
    taskId: string,
    scope?: {
      workspacePath?: string;
      threadId?: string;
      kind?: QuestionRequest["kind"];
      source?: QuestionRequest["source"];
      options?: QuestionRequest["options"];
      allowFreeform?: boolean;
    },
    onCreated?: (request: QuestionRequest) => void,
  ) => {
    const request = createQuestionRequest({
      taskId,
      question,
      workspacePath: scope?.workspacePath,
      threadId: scope?.threadId,
      kind: scope?.kind,
      source: scope?.source,
      options: scope?.options,
      allowFreeform: scope?.allowFreeform,
    });
    onCreated?.(request);
    return actionRequiredController.request({
      id: request.id,
      kind: "question",
      question: request.question,
      options: request.options,
      allowFreeform: request.allowFreeform,
      workspacePath: request.workspacePath,
      threadId: request.threadId,
      taskId: request.taskId,
      title: "Question",
      description: request.question,
    }).then((resolution) => {
      if (resolution.status === "cancelled" || resolution.status === "expired" || resolution.status === "denied") return null;
      return resolution.answer || resolution.toolResultText.replace(/^User answered:\s*/i, "");
    });
  }, [actionRequiredController]);

  useEffect(() => {
    if (restoredRecentWorkspaceRef.current) return;
    if (fs.workspaceRoot) {
      restoredRecentWorkspaceRef.current = true;
      return;
    }
    if (session.isLoading || projectStore.isLoadingProjects) return;
    if (session.providerSettings.general?.openLastWorkspace === false) return;

    const lastProjectPath = projectStore.recentProjects[0]?.workspacePath;
    if (!lastProjectPath) return;

    restoredRecentWorkspaceRef.current = true;
    void setWorkspaceRoot(lastProjectPath);
  }, [
    fs.workspaceRoot,
    projectStore.isLoadingProjects,
    projectStore.recentProjects,
    session.isLoading,
    session.providerSettings.general?.openLastWorkspace,
    setWorkspaceRoot,
  ]);

  const requestPostPatchVerification = useCallback(async (eventId: string) => {
    const event = threadEventsRef.current.find((item) => item.id === eventId);
    const patchPaths = event?.patches?.map((patch) => patch.path).filter(Boolean) || [];
    const patchTopDirs = Array.from(new Set(
      patchPaths
        .map((path) => path.split("/")[0])
        .filter((segment) => segment && segment !== "." && !segment.includes("..")),
    ));
    const cwd = patchTopDirs.length === 1 && patchPaths.every((path) => path.includes("/"))
      ? patchTopDirs[0]
      : undefined;
    const activeTaskId = agentRunSessionRef.current?.taskId;
    const task = (
      activeTaskId
        ? session.importedPlan?.plan.tasks.find(t => t.id === activeTaskId && t.verification?.some(Boolean))
        : session.importedPlan?.plan.tasks.find(t => t.status !== "done" && t.status !== "verified" && t.verification?.some(Boolean))
    ) ?? session.importedPlan?.plan.tasks.find(t => t.verification?.some(Boolean));
    const packageScripts = await readPackageScripts(fs.workspaceRoot, cwd);
    const parsed = selectVerificationCommand({
      planCommands: task?.verification?.filter(Boolean) || [],
      cwd,
      packageScripts,
    });
    if (!task || !parsed) {
      emitWorkspaceEvent({
        id: `verify-missing-${Date.now()}`,
        kind: "verification",
        role: "verifier",
        title: "Verification",
        status: "idle",
        message: "补丁已写入。当前任务没有配置验证命令，请手动检查结果。",
        verification: {
          status: "cancelled",
          reason: "No verification command configured for the current task.",
        },
      });
      return;
    }

    const displayCommand = formatCommandForDisplay(parsed.command, parsed.args);
    const reason = `补丁 ${eventId} 已写入，运行验证命令确认当前任务：${task.title}`;

    emitWorkspaceEvent({
      id: `verify-request-${Date.now()}`,
      kind: "verification",
      workspacePath: fs.workspaceRoot,
      threadId: threadUi.threadId,
      taskId: task.id,
      role: "verifier",
      title: "Verification Approval",
      status: "thinking",
      message: `补丁已事务写入。等待中心授权确认验证命令：${displayCommand}`,
      verification: {
        command: parsed.command,
        args: parsed.args,
        cwd: parsed.cwd,
        status: "pending",
        reason,
      },
    });

    requestRuntimePermission("run_command", {
      command: parsed.command,
      args: parsed.args,
      ...(parsed.cwd ? { cwd: parsed.cwd } : {}),
      reason,
      taskId: task.id,
      sourceEventId: eventId,
      threadId: threadUi.threadId,
      workspacePath: fs.workspaceRoot,
    }, reason).then((permission) => {
      if (!permission.approved) {
        emitWorkspaceEvent({
          id: `verify-denied-${Date.now()}`,
          kind: "verification",
          workspacePath: fs.workspaceRoot,
          threadId: threadUi.threadId,
          taskId: task.id,
          role: "verifier",
          title: "Verification Denied",
          status: "done",
          message: `你拒绝了验证命令：${displayCommand}。Agent 不会自动运行测试。`,
          verification: {
            command: parsed.command,
            args: parsed.args,
            cwd: parsed.cwd,
            status: "denied",
            reason,
          },
        });
        return;
      }
      emitWorkspaceEvent({
        id: `verify-approved-${Date.now()}`,
        kind: "verification",
        workspacePath: fs.workspaceRoot,
        threadId: threadUi.threadId,
        taskId: task.id,
        role: "verifier",
        title: "Verification Approval",
        status: "done",
        message: `你已批准验证命令：${displayCommand}。Orbit 将在当前工作区运行它。`,
        verification: {
          command: parsed.command,
          args: parsed.args,
          cwd: parsed.cwd,
          status: "approved",
          reason,
        },
      });
      fs.executeStructuredCommand({
        taskId: task.id,
        threadId: threadUi.threadId,
        command: parsed.command,
        args: parsed.args,
        reason,
        workspacePath: fs.workspaceRoot,
        cwd: parsed.cwd,
      });
    });
  }, [emitWorkspaceEvent, fs, requestRuntimePermission, session.importedPlan, threadUi.threadId]);

  const agentRun = useAgentRun({
    importedPlan: session.importedPlan,
    updateTask: session.updateTask,
    providerSettings: session.providerSettings,
    apiKeys: session.apiKeys,
    runControls,
    workspaceRoot: fs.workspaceRoot,
    threadId: threadUi.threadId,
    securitySettings: session.providerSettings.security,
    projectSecurityOverride,
    requestApproval: requestRuntimePermission,
    cancelPendingApprovals: () => cancelRuntimeActionsByKind("approval"),
    requestQuestion: requestRuntimeQuestion,
    cancelPendingQuestions: () => cancelRuntimeActionsByKind("question"),
    recordTerminalResult: fs.recordTerminalResult,
    emitThreadEvent,
    updateThreadEvent,
    onPatchReviewRequired: appendPatchReviewAction,
    toolCallLifecycleStore: {
      list: () => toolCallLifecyclesRef.current,
      append: appendToolCallLifecycle,
      update: updateToolCallLifecycle,
    },
    getExtensionContext: collectRuntimeContext,
    initialAgentRunSession: session.loadedAgentRunSession,
  });

  useEffect(() => {
    dispatchRuntimeLedger({ type: "setTerminalRuns", runs: fs.terminalRuns });
  }, [fs.terminalRuns]);
  useEffect(() => { terminalRunsRef.current = runtimeState.terminalRuns; }, [runtimeState.terminalRuns]);
  useEffect(() => { agentRunSessionRef.current = agentRun.agentRunSession; }, [agentRun.agentRunSession]);

  useEffect(() => {
    recoverAgentRunSessionRef.current = agentRun.recoverAgentRunSession;
    recoverTerminalRunsRef.current = fs.recoverTerminalRuns;
    return () => {
      recoverAgentRunSessionRef.current = null;
      recoverTerminalRunsRef.current = null;
    };
  }, [agentRun.recoverAgentRunSession, fs.recoverTerminalRuns]);

  useEffect(() => {
    markVerificationCompletedForContinueRef.current = agentRun.markVerificationCompletedForContinue;
    return () => {
      markVerificationCompletedForContinueRef.current = null;
    };
  }, [agentRun.markVerificationCompletedForContinue]);

  const saveCheckpointRuntimeSnapshot = useCallback((checkpointId: string, event: ThreadEvent) => {
    dispatchRuntimeLedger({ type: "saveCheckpointRuntimeSnapshot", checkpoint: {
      checkpointId,
      threadId: event.threadId || threadUi.threadId,
      workspacePath: event.workspacePath || fs.workspaceRoot,
      runtimeLedgerSnapshot: {
        threadEvents: serializeThreadEvents(threadEventsRef.current),
        actionRequired: actionRequiredRef.current,
        toolCalls: toolCallLifecyclesRef.current,
        terminalRuns: terminalRunsRef.current,
      },
      agentRunSession: agentRunSessionRef.current || undefined,
      createdAt: new Date().toISOString(),
    } });
  }, [fs.workspaceRoot, threadUi.threadId]);

  const patchWorkflow = usePatchWorkflow({
    threadEventsRef,
    updateThreadEvent,
    emitThreadEvent,
    fs,
    isRealLLMActiveRef,
    activeLLMConfigRef,
    onCheckpointCreated: saveCheckpointRuntimeSnapshot,
    onPatchApplied: (eventId) => {
      void requestPostPatchVerification(eventId);
      const event = threadEventsRef.current.find((item) => item.id === eventId);
      const patchPaths = event?.patches?.map((patch) => patch.path).filter(Boolean) || [];
      const activeTaskId = agentRunSessionRef.current?.taskId;
      const task = (
        activeTaskId
          ? session.importedPlan?.plan.tasks.find(t => t.id === activeTaskId && t.verification?.some(Boolean))
          : session.importedPlan?.plan.tasks.find(t => t.status !== "done" && t.status !== "verified" && t.verification?.some(Boolean))
      ) ?? session.importedPlan?.plan.tasks.find(t => t.verification?.some(Boolean));
      const verification = task?.verification?.filter(Boolean).join(" && ");
      agentRun.markPatchAppliedForContinue(eventId, [
        patchPaths.length ? `Applied files: ${patchPaths.join(", ")}.` : "",
        verification ? `Verification approval queued for: ${verification}.` : "No verification command was available in the plan.",
      ].filter(Boolean).join(" "));
    },
  });

  const runtimeLedgerSnapshot = useMemo(() => new RuntimeLedger({
    threadEvents,
    actionRequired,
    toolCalls: toolCallLifecycles,
    terminalRuns: runtimeState.terminalRuns,
    checkpointRuntimeSnapshots: runtimeState.checkpointRuntimeSnapshots,
  }).ledgerSnapshot(), [actionRequired, runtimeState.terminalRuns, runtimeState.checkpointRuntimeSnapshots, threadEvents, toolCallLifecycles]);

  const reviewDockModel = useMemo(() => buildReviewDockModel({
    ledger: runtimeLedgerSnapshot,
    workspacePath: fs.workspaceRoot,
    threadId: threadUi.threadId,
    taskId: agentRun.agentRunSession.taskId,
    approvalGrants,
  }), [agentRun.agentRunSession.taskId, approvalGrants, fs.workspaceRoot, runtimeLedgerSnapshot, threadUi.threadId]);

  const sessionBrowserModel = useMemo(() => buildSessionBrowserModel({
    threads: threadUi.allThreadsForWorkspace,
    snapshots: threadSnapshots,
    workspacePath: fs.workspaceRoot,
    activeThreadId: threadUi.threadId,
    searchQuery: sessionSearchQuery,
  }), [fs.workspaceRoot, sessionSearchQuery, threadSnapshots, threadUi.allThreadsForWorkspace, threadUi.threadId]);

  const resolveActionRequired = useCallback((id: string, approved: boolean) => {
    const action = actionRequiredRef.current.find((item) => item.id === id);
    const result = actionRequiredController.resolve(id, {
      status: approved ? "approved" : "denied",
      reason: approved ? "User approved this action." : "User denied this action.",
    });
    if (approved && action && action.grantScope && action.grantScope !== "once") {
      setApprovalGrants((prev) => persistableApprovalGrants([
        {
          id: `grant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          tool: action.tool || action.kind,
          key: approvalGrantKey(action.tool || action.kind, action.params || {}),
          mode: runControls.mode,
          actions: inferPermissionActions(action.tool || action.kind, action.params || {}),
          cwdOrPathScope: typeof action.params?.cwd === "string" ? action.params.cwd : undefined,
          workspacePath: action.workspacePath,
          threadId: action.threadId,
          scope: action.grantScope as "session" | "project",
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]));
    }
    if (!action || result.hadLiveResolver) return;
    if (approved && action.tool === "run_command") {
      const params = action.params as Record<string, unknown> | undefined;
      const command = typeof params?.command === "string" ? params.command : "";
      const args = Array.isArray(params?.args) ? params.args.filter((arg): arg is string => typeof arg === "string") : [];
      if (command) {
        fs.executeStructuredCommand({
          taskId: action.taskId || agentRun.agentRunSession.taskId || action.id,
          threadId: action.threadId || agentRun.agentRunSession.threadId || threadUi.threadId,
          approvalId: action.id,
          command,
          args,
          reason: action.reason || action.description,
          workspacePath: action.workspacePath || fs.workspaceRoot,
          cwd: typeof params?.cwd === "string" ? params.cwd : undefined,
        });
        return;
      }
    }
    agentRun.markRecoveredActionForContinue(
      action.kind === "verification" ? "verification" : "approval",
      action.resumeAction || { type: action.kind === "verification" ? "verification" : "approval", payloadId: id },
      result.toolResultText,
      approved
        ? "恢复的授权已批准。点击“继续执行”后，Agent 会继续当前任务。"
        : "恢复的授权已拒绝。点击“继续执行”后，Agent 会把拒绝结果纳入下一步。",
    );
  }, [actionRequiredController, agentRun, fs, runControls.mode, threadUi.threadId]);

  const cancelActionRequired = useCallback((id: string) => {
    const action = actionRequiredRef.current.find((item) => item.id === id);
    const result = actionRequiredController.cancel(id);
    if (!action || result.hadLiveResolver) return;
    agentRun.markRecoveredActionForContinue(
      action.kind === "question" ? "question" : action.kind === "patchReview" ? "patchReview" : action.kind === "verification" ? "verification" : "approval",
      action.resumeAction || { type: action.kind === "question" ? "question" : action.kind === "patchReview" ? "patchReview" : action.kind === "verification" ? "verification" : "approval", payloadId: id },
      result.toolResultText,
      "恢复的待处理操作已取消。点击“继续执行”后，Agent 会继续当前任务。",
    );
  }, [actionRequiredController, agentRun]);

  const answerActionRequiredQuestion = useCallback((id: string, input: string | QuestionAnswerInput) => {
    const action = actionRequiredRef.current.find((item) => item.id === id);
    const question: QuestionRequest = {
      id,
      workspacePath: action?.workspacePath || fs.workspaceRoot,
      threadId: action?.threadId || threadUi.threadId,
      taskId: action?.taskId || "",
      kind: action?.options?.length ? "singleChoice" : "text",
      source: "agent",
      question: action?.question || action?.description || "",
      options: action?.options,
      allowFreeform: action?.allowFreeform,
      status: "pending",
      createdAt: action?.createdAt || new Date().toISOString(),
    };
    const formatted = formatQuestionAnswer(question, input);
    const result = actionRequiredController.resolve(id, {
      status: "resolved",
      answer: formatted.answer,
      toolResultText: `User answered: ${formatted.answer}`,
    });
    emitWorkspaceEvent({
      id: `question-result-${Date.now()}`,
      kind: "question",
      workspacePath: question.workspacePath,
      threadId: question.threadId,
      taskId: question.taskId,
      role: "planner",
      title: "Question Answered",
      status: "done",
      message: `你已回答 Agent 的问题：${formatted.answer}。点击“继续执行”后 Agent 才会继续。`,
      question: {
        requestId: id,
        question: question.question,
        status: "answered",
        answer: formatted.answer,
        selectedOptionId: formatted.selectedOptionId,
        options: question.options,
      },
    });
    if (result.hadLiveResolver) return;
    agentRun.markRecoveredActionForContinue(
      "question",
      action?.resumeAction || { type: "question", payloadId: id },
      result.toolResultText,
      "恢复的问题已回答。点击“继续执行”后，Agent 会继续当前任务。",
    );
  }, [actionRequiredController, agentRun, emitWorkspaceEvent, fs.workspaceRoot, threadUi.threadId]);

  const updateActionRequiredGrantScope = useCallback((id: string, grantScope: "once" | "session" | "project") => {
    dispatchRuntimeLedger({ type: "updateActionRequired", id, update: { grantScope } });
  }, []);

  const revokeApprovalGrant = useCallback((id: string) => {
    setApprovalGrants((prev) => prev.filter((grant) => grant.id !== id));
  }, []);

  const applyActionRequiredPatch = useCallback(async (eventId: string) => {
    await patchWorkflow.applyEventPatch(eventId);
  }, [patchWorkflow]);

  const restoreCheckpointRuntime = useCallback((checkpointId: string) => {
    const saved = runtimeState.checkpointRuntimeSnapshots[checkpointId];
    if (!saved) return false;
    const checkpointEvent = threadEventsRef.current.find((item) => item.checkpoint?.checkpointId === checkpointId);
    const restored = checkpointRestoreController.restore({
      checkpointId,
      checkpointEvent,
      runtimeSnapshot: saved,
      fallbackWorkspacePath: fs.workspaceRoot,
      fallbackThreadId: threadUi.threadId,
    });
    replaceRuntimeLedgerSnapshot({
      threadEvents: serializeThreadEvents(restored.ledger.threadEvents),
      actionRequired: restored.ledger.actionRequired,
      toolCalls: restored.ledger.toolCalls,
      terminalRuns: restored.ledger.terminalRuns,
      checkpointRuntimeSnapshots: runtimeState.checkpointRuntimeSnapshots,
    });
    recoverTerminalRunsRef.current?.(restored.ledger.terminalRuns || [], true);
    recoverToolCallLifecycles(restored.ledger.toolCalls || [], true);
    recoverAgentRunSessionRef.current?.((saved.agentRunSession as AgentRunSession | undefined) ?? null);
    const resume = resumeController.resume({
      kind: "patchReview",
      resumeAction: restored.action.resumeAction || { type: "patchReview", payloadId: restored.action.id },
      toolResultText: `Checkpoint ${checkpointId} restored. User must explicitly continue.`,
      message: "已恢复 checkpoint。点击“继续执行”后，Agent 会基于恢复后的状态继续。",
    });
    agentRun.markRecoveredActionForContinue(
      "patchReview",
      resume.resumeAction,
      resume.toolResultText,
      resume.message,
    );
    return true;
  }, [agentRun, checkpointRestoreController, fs.workspaceRoot, recoverToolCallLifecycles, resumeController, runtimeState.checkpointRuntimeSnapshots, threadUi.threadId]);

  const rollbackEventPatch = useCallback(async (eventId: string) => {
    const event = threadEventsRef.current.find((item) => item.id === eventId);
    const checkpointId = event?.checkpoint?.checkpointId;
    await patchWorkflow.rollbackEventPatch(eventId);
    if (checkpointId) restoreCheckpointRuntime(checkpointId);
  }, [patchWorkflow, restoreCheckpointRuntime]);

  const restoreCheckpoint = useCallback(async (checkpointId: string) => {
    const event = threadEventsRef.current.find((item) => item.checkpoint?.checkpointId === checkpointId);
    if (event?.id) {
      await rollbackEventPatch(event.id);
      return;
    }
    restoreCheckpointRuntime(checkpointId);
  }, [rollbackEventPatch, restoreCheckpointRuntime]);

  useEffect(() => {
    if (session.isLoading) return;
    const timer = setTimeout(() => {
      sessionStore.saveSession({
        activeProjectId: "default",
        activeThreadId: threadUi.threadId,
        importedPlan: session.importedPlan,
        providerSettings: session.providerSettings,
        runtimeLedgerSnapshot: new RuntimeLedger({
          threadEvents: serializeThreadEvents(threadEvents),
          actionRequired,
          toolCalls: toolCallLifecycles,
          terminalRuns: runtimeState.terminalRuns,
          checkpointRuntimeSnapshots: runtimeState.checkpointRuntimeSnapshots,
        }).serializeSnapshot(),
        agentRunSession: agentRun.agentRunSession,
        approvalGrants: persistableApprovalGrants(approvalGrants),
        lastActiveAt: new Date().toISOString(),
      }).catch(console.error);
    }, 2000);
    return () => clearTimeout(timer);
  }, [session.importedPlan, session.providerSettings, threadEvents, actionRequired, agentRun.agentRunSession, toolCallLifecycles, runtimeState.terminalRuns, runtimeState.checkpointRuntimeSnapshots, approvalGrants, session.isLoading, threadUi.threadId]);

  useEffect(() => {
    persistCurrentThreadSnapshot();
  }, [threadEvents, actionRequired, toolCallLifecycles, approvalGrants, runtimeState.terminalRuns, persistCurrentThreadSnapshot, session.importedPlan]);

  return {
    // From session
    isLoading: session.isLoading,
    importedPlan: session.importedPlan,
    importError: session.importError,
    providerSettings: session.providerSettings,
    apiKeys: session.apiKeys,
    credentialVaultProviders: session.credentialVaultProviders,
    credentialVaultAutoUnlock: session.credentialVaultAutoUnlock,
    isRealLLMActive: session.isRealLLMActive,
    activeLLMConfig: session.activeLLMConfig,
    runControls,
    activeTitle: session.activeTitle,
    outputFiles: session.outputFiles,
    importPlan: session.importPlan,
    submitPlanMessage,
    acceptPlanDraft,
    clearImportedPlan: () => {
      session.clearImportedPlan();
      setThreadEvents([]);
    },
    updateTask: session.updateTask,
    addTask: session.addTask,
    deleteTask: session.deleteTask,
    moveTask: session.moveTask,
    updateProviderSettings: session.updateProviderSettings,
    updateApiKey: session.updateApiKey,
    unlockCredentialVault: session.unlockCredentialVault,
    disableCredentialVaultAutoUnlock: session.disableCredentialVaultAutoUnlock,
    effectiveSecurityPolicy,
    projectSecurityOverride,
    updateProjectSecurityOverride,
    // From file system
    workspaceRoot: fs.workspaceRoot,
    workspaceError: fs.workspaceError,
    workspaceFiles: fs.workspaceFiles,
    activeFilePath: fs.activeFilePath,
    activeFileContent: fs.activeFileContent,
    terminalLogs: fs.terminalLogs,
    terminalRuns: runtimeState.terminalRuns,
    commandStatus: fs.commandStatus,
    viewFile: fs.viewFile,
    setWorkspaceRoot,
    refreshFileTree: fs.refreshFileTree,
    executeCommand: fs.executeCommand,
    // From useWorkspace
    threadEvents,
    emitThreadEvent,
    updateThreadEvent,
    actionRequired,
    pendingActions: selectPendingActions(runtimeLedgerSnapshot),
    runSteps: selectRunSteps(runtimeLedgerSnapshot),
    startCollaborationFlow: () => {
      if (session.importedPlan) {
        startCollaborationFlow(session.importedPlan);
      }
    },
    applyEventPatch: applyActionRequiredPatch,
    rollbackEventPatch,
    restoreCheckpoint,
    refinePatch: patchWorkflow.refinePatch,
    updateEventPatch: patchWorkflow.updateEventPatch,
    agentLoopPhase: agentRun.agentLoopPhase,
    agentLoopToolCalls: agentRun.agentLoopToolCalls,
    agentLoopRunning: agentRun.agentLoopRunning,
    startAgentLoop: agentRun.startAgentLoop,
    continueAgentRun: agentRun.continueAgentRun,
    submitBuildMessage: agentRun.submitBuildMessage,
    cancelAgentLoop: agentRun.cancelAgentLoop,
    buildEmbeddings: embeddingIndex.buildEmbeddings,
    embeddingBuildProgress: embeddingIndex.embeddingBuildProgress,
    streamingContent: agentRun.streamingContent,
    streamingActive: agentRun.streamingActive,
    agentRunSession: agentRun.agentRunSession,
    reviewDockModel,
    sessionBrowserModel,
    sessionSearchQuery,
    setSessionSearchQuery,
    currentContextInspector,
    refreshCurrentContext,
    evaluateDeepSeekSmokeRun,
    writeProjectContextFile,
    legacyQueuesForMigrationOnly: {
      agentEvents: [] as AgentEvent[],
      approvalRequests: [] as ApprovalRequest[],
      questionRequests: [] as QuestionRequest[],
    },
    answerActionRequiredQuestion,
    cancelActionRequired,
    openNewWindow: () => windowActions.openNewWindow(fs.workspaceRoot || undefined),
    resolveActionRequired,
    updateActionRequiredGrantScope,
    revokeApprovalGrant,
    recentProjects: projectStore.recentProjects,
    visibleProjects: projectActions.visibleProjects,
    archivedProjects: projectActions.archivedProjects,
    projectUiState: projectActions.projectUiState,
    togglePinnedProject: projectActions.togglePinnedProject,
    archiveProject: projectActions.archiveProject,
    removeRecentProject: projectActions.removeRecentProject,
    renameProject: projectActions.renameProject,
    revealProject: projectActions.revealProject,
    isLoadingProjects: projectStore.isLoadingProjects,
    refreshProjects: projectStore.refreshProjects,
    layoutPreferences: layout.layoutPreferences,
    updateLayoutPreferences: layout.updateLayoutPreferences,
    toggleReviewDock: layout.toggleReviewDock,
    usageSnapshot: buildUsageSnapshot(runtimeState.terminalRuns),
    threadId: threadUi.threadId,
    threadUiState: threadUi.threadUiState,
    threadList: threadUi.threadList,
    threadsByProject: threadUi.threadsByProject,
    createThread,
    switchThread,
    restoreThreadById: restoreArchivedThreadById,
    updateThreadUiState: threadUi.updateThreadUiState,
    togglePinnedThread: threadUi.togglePinnedThread,
    renameThread: threadUi.renameThread,
    archiveThread: (archived = true) => archiveThreadById(threadUi.threadId, archived),
    togglePinnedThreadById,
    renameThreadById,
    archiveThreadById,
    deleteThreadById,
  };
}
