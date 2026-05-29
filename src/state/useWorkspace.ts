import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "../domain/agentEvents";
import type { AgentRunSession } from "../domain/agentRunSession";
import { formatQuestionAnswer, type QuestionAnswerInput, type QuestionRequest } from "../domain/questionRequest";
import type { TerminalRun } from "../domain/terminalRun";
import { createThreadEvent, type CreateThreadEventInput, type ThreadEvent } from "../domain/threadEvents";
import { serializeThreadEvents } from "../domain/threadEvents";
import type { ActionRequiredEvent } from "../domain/actionRequired";
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
import { useApprovalQueue } from "./useApprovalQueue";
import { useQuestionQueue } from "./useQuestionQueue";
import { useProjectStore } from "./useProjectStore";
import { usePatchWorkflow } from "./usePatchWorkflow";
import { useAgentRun } from "./useAgentRun";
import { useRunControls } from "./useRunControls";
import { useLayoutPreferences } from "./useLayoutPreferences";
import { useProjectActions } from "./useProjectActions";
import { useThreadUiState } from "./useThreadUiState";
import type { ImportedPlanState } from "./useSession";
import { formatCommandForDisplay } from "../runtime/commandParser";
import { selectVerificationCommand } from "../runtime/verificationCommand";
import { buildEffectiveSecurityPolicy } from "../runtime/securityPolicy";
import { ContextProviderRegistry, type ContextInspectorModel } from "../runtime/contextProviders";
import { PermissionScheduler } from "../runtime/permissionScheduler";
import { invokeDesktop } from "../runtime/desktopGateway";
import { buildUsageSnapshot } from "./usageSnapshot";
import { buildReviewDockModel } from "../features/review/reviewDockModel";
import type { ApprovalGrant, ApprovalRequest } from "./useApprovalQueue";
import { isTauri } from "../utils/tauri";
import { findProvider } from "../providers/providerRegistry";
import { runPlannerTurn, summarizePlanDraft } from "./plannerEngine";
import {
  restoreThreadEventStore,
} from "./threadEventStore";
import { RuntimeLedger } from "./threadRuntimeStore";
import { createDeepSeekSmokeRunRecord, type SmokeRunRecord } from "../runtime/deepSeekSmokeHarness";

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
  terminalRuns?: TerminalRun[];
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

  const [threadEvents, setThreadEvents] = useState<ThreadEvent[]>([]);
  const [actionRequired, setActionRequired] = useState<ActionRequiredEvent[]>([]);
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
  const approvalRequestsRef = useRef<ApprovalRequest[]>([]);
  const questionRequestsRef = useRef<QuestionRequest[]>([]);
  const actionRequiredRef = useRef<ActionRequiredEvent[]>([]);
  const terminalRunsRef = useRef<TerminalRun[]>([]);

  useEffect(() => { threadEventsRef.current = threadEvents; }, [threadEvents]);
  useEffect(() => { actionRequiredRef.current = actionRequired; }, [actionRequired]);
  useEffect(() => { isRealLLMActiveRef.current = session.isRealLLMActive; }, [session.isRealLLMActive]);
  useEffect(() => { activeLLMConfigRef.current = session.activeLLMConfig; }, [session.activeLLMConfig]);
  useEffect(() => { healingAttemptsRef.current = healingAttempts; }, [healingAttempts]);

  useEffect(() => {
    return () => {
      timerRef.current.forEach(clearTimeout);
      timerRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (restoredInitialSessionEventsRef.current) return;
    if (session.loadedThreadEvents && session.loadedThreadEvents.length > 0 && threadEvents.length === 0) {
      restoredInitialSessionEventsRef.current = true;
      setThreadEvents(restoreThreadEventStore({ threadEvents: session.loadedThreadEvents }));
      return;
    }
    if (session.loadedAgentEvents && session.loadedAgentEvents.length > 0 && threadEvents.length === 0) {
      restoredInitialSessionEventsRef.current = true;
      setThreadEvents(restoreThreadEventStore({ agentEvents: session.loadedAgentEvents as AgentEvent[] }));
    }
  }, [session.loadedAgentEvents, session.loadedThreadEvents, threadEvents.length]);

  const emitThreadEvent = useCallback((event: ThreadEvent) => {
    setThreadEvents((prev) => new RuntimeLedger({
      threadEvents: prev,
      actionRequired: actionRequiredRef.current,
    }).appendThreadEvent(event).events);
  }, []);

  const emitWorkspaceEvent = useCallback((event: CreateThreadEventInput) => {
    setThreadEvents((prev) => new RuntimeLedger({
      threadEvents: prev,
      actionRequired: actionRequiredRef.current,
    }).appendThreadEvent(createThreadEvent(event)).events);
  }, []);

  const updateThreadEvent = useCallback((id: string, update: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent)) => {
    setThreadEvents((prev) => new RuntimeLedger({
      threadEvents: prev,
      actionRequired: actionRequiredRef.current,
    }).updateThreadEvent(id, update).events);
  }, []);

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
  const approvalQueue = useApprovalQueue();
  const questionQueue = useQuestionQueue();
  const contextProviderRegistry = useMemo(() => new ContextProviderRegistry(), []);
  const permissionScheduler = useMemo(
    () => new PermissionScheduler({ enqueueApproval: approvalQueue.requestApproval }),
    [approvalQueue.requestApproval],
  );
  const projectStore = useProjectStore();
  const layout = useLayoutPreferences();
  const projectActions = useProjectActions(projectStore.recentProjects);
  const runControls = useRunControls(session.providerSettings, session.apiKeys, session.credentialVaultProviders);

  useEffect(() => {
    if (session.loadedQuestionRequests && session.loadedQuestionRequests.length > 0) {
      questionQueue.recoverQuestions(session.loadedQuestionRequests);
    }
  }, [questionQueue.recoverQuestions, session.loadedQuestionRequests]);

  useEffect(() => {
    if (session.loadedApprovalRequests && session.loadedApprovalRequests.length > 0) {
      approvalQueue.recoverApprovals(session.loadedApprovalRequests);
    }
  }, [approvalQueue.recoverApprovals, session.loadedApprovalRequests]);

  useEffect(() => {
    if (session.loadedApprovalGrants && session.loadedApprovalGrants.length > 0) {
      approvalQueue.recoverGrants(session.loadedApprovalGrants);
    }
  }, [approvalQueue.recoverGrants, session.loadedApprovalGrants]);

  useEffect(() => {
    if (session.loadedActionRequired && session.loadedActionRequired.length > 0 && actionRequired.length === 0) {
      setActionRequired(session.loadedActionRequired);
    }
  }, [actionRequired.length, session.loadedActionRequired]);

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

  const persistCurrentThreadSnapshot = useCallback((threadId = threadUi.threadId) => {
    if (!threadId) return;
    setThreadSnapshots((prev) => ({
      ...prev,
      [threadId]: {
        importedPlan: session.importedPlan,
        threadEvents: serializeThreadEvents(threadEventsRef.current),
        agentRunSession: agentRunSessionRef.current,
        approvalRequests: approvalRequestsRef.current,
        approvalGrants: approvalQueue.approvalGrants,
        questionRequests: questionRequestsRef.current,
        actionRequired: actionRequiredRef.current,
        terminalRuns: terminalRunsRef.current,
        updatedAt: new Date().toISOString(),
      },
    }));
  }, [approvalQueue.approvalGrants, session.importedPlan, threadUi.threadId]);

  const restoreThreadSnapshot = useCallback((threadId: string) => {
    const snapshot = threadSnapshots[threadId];
    approvalQueue.cancelPendingApprovals();
    questionQueue.cancelPendingQuestions();
    session.restoreImportedPlan(snapshot?.importedPlan ?? null);
    setThreadEvents(restoreThreadEventStore({
      threadEvents: snapshot?.threadEvents,
      agentEvents: snapshot?.agentEvents,
    }));
    setActionRequired(snapshot?.actionRequired ?? []);
    approvalQueue.recoverApprovals(snapshot?.approvalRequests ?? [], true);
    approvalQueue.recoverGrants([
      ...approvalQueue.approvalGrants.filter((grant) => grant.scope === "project"),
      ...(snapshot?.approvalGrants ?? []),
    ], true);
    questionQueue.recoverQuestions(snapshot?.questionRequests ?? [], true);
    recoverTerminalRunsRef.current?.(snapshot?.terminalRuns ?? [], true);
    recoverAgentRunSessionRef.current?.(snapshot?.agentRunSession ?? null);
  }, [approvalQueue, questionQueue, session, threadSnapshots]);

  const createThread = useCallback(() => {
    persistCurrentThreadSnapshot();
    const nextThreadId = threadUi.createThread();
    approvalQueue.cancelPendingApprovals();
    questionQueue.cancelPendingQuestions();
    approvalQueue.recoverApprovals([], true);
    approvalQueue.recoverGrants(approvalQueue.approvalGrants.filter((grant) => grant.scope === "project"), true);
    questionQueue.recoverQuestions([], true);
    setActionRequired([]);
    recoverTerminalRunsRef.current?.([], true);
    recoverAgentRunSessionRef.current?.(null);
    session.restoreImportedPlan(null);
    setThreadEvents([]);
    return nextThreadId;
  }, [approvalQueue, persistCurrentThreadSnapshot, questionQueue, session, threadUi]);

  const switchThread = useCallback((nextThreadId: string) => {
    if (!nextThreadId || nextThreadId === threadUi.threadId) return;
    persistCurrentThreadSnapshot();
    threadUi.switchThread(nextThreadId);
    restoreThreadSnapshot(nextThreadId);
  }, [persistCurrentThreadSnapshot, restoreThreadSnapshot, threadUi]);

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
    onActionCreated: (action) => {
      setActionRequired((prev) => new RuntimeLedger({
        threadEvents: threadEventsRef.current,
        actionRequired: prev.filter((item) => item.id !== action.id),
      }).appendActionRequired(action).actionRequired);
    },
    onActionResolved: (action) => {
      setActionRequired((prev) => new RuntimeLedger({
        threadEvents: threadEventsRef.current,
        actionRequired: prev,
      }).updateActionRequired(action.id, action).actionRequired);
    },
    onCreated: (request) => onCreated?.(request),
  }).then((result) => result.approved), [
    fs.workspaceRoot,
    permissionScheduler,
    projectSecurityOverride,
    runControls.mode,
    session.providerSettings.security,
    threadUi.threadId,
  ]);

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
    }, reason).then((approved) => {
      if (!approved) {
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
    cancelPendingApprovals: approvalQueue.cancelPendingApprovals,
    requestQuestion: questionQueue.requestQuestion,
    cancelPendingQuestions: questionQueue.cancelPendingQuestions,
    recordTerminalResult: fs.recordTerminalResult,
    emitThreadEvent,
    updateThreadEvent,
    getExtensionContext: collectRuntimeContext,
    initialAgentRunSession: session.loadedAgentRunSession,
  });

  useEffect(() => { approvalRequestsRef.current = approvalQueue.approvalRequests; }, [approvalQueue.approvalRequests]);
  useEffect(() => { questionRequestsRef.current = questionQueue.questionRequests; }, [questionQueue.questionRequests]);
  useEffect(() => { terminalRunsRef.current = fs.terminalRuns; }, [fs.terminalRuns]);
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

  const patchWorkflow = usePatchWorkflow({
    threadEventsRef,
    updateThreadEvent,
    emitThreadEvent,
    fs,
    isRealLLMActiveRef,
    activeLLMConfigRef,
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

  const reviewDockModel = useMemo(() => buildReviewDockModel({
    approvals: approvalQueue.approvalRequests,
    questions: questionQueue.questionRequests,
    events: threadEvents,
    terminalRuns: fs.terminalRuns,
    workspacePath: fs.workspaceRoot,
    threadId: threadUi.threadId,
    taskId: agentRun.agentRunSession.taskId,
  }), [agentRun.agentRunSession.taskId, approvalQueue.approvalRequests, fs.terminalRuns, fs.workspaceRoot, questionQueue.questionRequests, threadEvents, threadUi.threadId]);

  const runtimeLedgerSnapshot = useMemo(() => new RuntimeLedger({
    threadEvents,
    actionRequired,
    terminalRuns: fs.terminalRuns,
  }).ledgerSnapshot(), [actionRequired, fs.terminalRuns, threadEvents]);

  const resolveRecoveredApprovalAction = useCallback((request: ApprovalRequest, approved: boolean) => {
    const tool = request.tool;
    const params = request.params as Record<string, unknown>;
    const command = typeof params.command === "string" ? params.command : "";
    const args = Array.isArray(params.args) ? params.args.filter((arg): arg is string => typeof arg === "string") : [];
    const taskId = typeof params.taskId === "string"
      ? params.taskId
      : agentRun.agentRunSession.taskId || session.importedPlan?.plan.tasks[0]?.id || request.id;
    const reason = typeof params.reason === "string" ? params.reason : request.reason;
    const workspacePath = typeof params.workspacePath === "string" ? params.workspacePath : fs.workspaceRoot;
    const cwd = typeof params.cwd === "string" ? params.cwd : undefined;

    emitWorkspaceEvent({
      id: `recovered-approval-${Date.now()}`,
      kind: "approval",
      workspacePath,
      threadId: request.threadId || agentRun.agentRunSession.threadId || threadUi.threadId,
      taskId,
      role: "reviewer",
      title: approved ? "Recovered Approval Granted" : "Recovered Approval Denied",
      status: "done",
      message: approved
        ? `你已批准恢复的 ${tool} 操作。`
        : `你已拒绝恢复的 ${tool} 操作。`,
      approval: {
        requestId: request.id,
        tool,
        params: params as ToolParams,
        status: approved ? "approved" : "denied",
        grantScope: request.grantScope,
        reason,
      },
    });

    if (!approved) {
      agentRun.markRecoveredActionForContinue(
        "approval",
        { type: "approval", payloadId: request.id },
        `Denied ${tool}: ${JSON.stringify(params)}`,
        "恢复的审批已被拒绝。点击“继续执行”后，Agent 会把拒绝结果纳入下一步规划。",
      );
      return;
    }
    if (tool !== "run_command" || !command) {
      agentRun.markRecoveredActionForContinue(
        "approval",
        { type: "approval", payloadId: request.id },
        `Approved ${tool}: ${JSON.stringify(params)}`,
        "恢复的审批已通过。点击“继续执行”后，Agent 会继续当前任务。",
      );
      return;
    }
    fs.executeStructuredCommand({
      taskId,
      threadId: request.threadId || agentRun.agentRunSession.threadId || threadUi.threadId,
      approvalId: request.id,
      command,
      args,
      reason,
      workspacePath,
      cwd,
    });
  }, [agentRun, emitWorkspaceEvent, fs, session.importedPlan?.plan.tasks, threadUi.threadId]);

  const resolveApproval = useCallback((id: string, approved: boolean) => {
    const request = approvalQueue.approvalRequests.find((item) => item.id === id);
    const hadLiveResolver = approvalQueue.resolveApproval(id, approved);
    if (!request || hadLiveResolver) return;
    resolveRecoveredApprovalAction(request, approved);
  }, [approvalQueue, resolveRecoveredApprovalAction]);

  const answerQuestion = useCallback((id: string, input: string | QuestionAnswerInput) => {
    const question = questionQueue.questionRequests.find((item) => item.id === id);
    const answer = question ? formatQuestionAnswer(question, input).answer : typeof input === "string" ? input : input.answer || "";
    const hadLiveResolver = questionQueue.answerQuestion(id, input);
    if (!question || hadLiveResolver) return;
    emitWorkspaceEvent({
      id: `recovered-question-${Date.now()}`,
      kind: "question",
      workspacePath: question.workspacePath || fs.workspaceRoot,
      threadId: question.threadId || threadUi.threadId,
      taskId: question.taskId,
      role: "planner",
      title: "Recovered Question Answered",
      status: "done",
      message: `你已回答恢复的问题：${answer}`,
      question: {
        requestId: id,
        question: question.question,
        status: "answered",
        answer,
        selectedOptionId: typeof input === "string" ? undefined : input.selectedOptionId,
        options: question.options,
      },
    });
    agentRun.markRecoveredActionForContinue(
      "question",
      { type: "question", payloadId: id },
      `User answered: ${answer}`,
      "恢复的问题已回答。点击“继续执行”后，Agent 会继续当前任务。",
    );
  }, [agentRun, emitWorkspaceEvent, fs.workspaceRoot, questionQueue, threadUi.threadId]);

  const cancelQuestion = useCallback((id: string) => {
    const question = questionQueue.questionRequests.find((item) => item.id === id);
    const hadLiveResolver = questionQueue.cancelQuestion(id);
    if (!question || hadLiveResolver) return;
    emitWorkspaceEvent({
      id: `recovered-question-cancel-${Date.now()}`,
      kind: "question",
      workspacePath: question.workspacePath || fs.workspaceRoot,
      threadId: question.threadId || threadUi.threadId,
      taskId: question.taskId,
      role: "planner",
      title: "Recovered Question Cancelled",
      status: "done",
      message: "你取消了恢复的问题。",
      question: {
        requestId: id,
        question: question.question,
        status: "cancelled",
        options: question.options,
      },
    });
    agentRun.markRecoveredActionForContinue(
      "question",
      { type: "question", payloadId: id },
      "User cancelled question.",
      "恢复的问题已取消。点击“继续执行”后，Agent 会收到取消结果并重新规划。",
    );
  }, [agentRun, emitWorkspaceEvent, fs.workspaceRoot, questionQueue, threadUi.threadId]);

  useEffect(() => {
    if (session.isLoading) return;
    const timer = setTimeout(() => {
      sessionStore.saveSession({
        activeProjectId: "default",
        activeThreadId: threadUi.threadId,
        importedPlan: session.importedPlan,
        providerSettings: session.providerSettings,
        agentEvents: [],
        threadEvents: serializeThreadEvents(threadEvents),
        agentRunSession: agentRun.agentRunSession,
        approvalRequests: approvalQueue.approvalRequests,
        approvalGrants: approvalQueue.approvalGrants,
        questionRequests: questionQueue.questionRequests,
        actionRequired,
        terminalRuns: fs.terminalRuns,
        lastActiveAt: new Date().toISOString(),
      }).catch(console.error);
    }, 2000);
    return () => clearTimeout(timer);
  }, [session.importedPlan, session.providerSettings, threadEvents, actionRequired, agentRun.agentRunSession, approvalQueue.approvalRequests, questionQueue.questionRequests, fs.terminalRuns, session.isLoading, threadUi.threadId]);

  useEffect(() => {
    persistCurrentThreadSnapshot();
  }, [threadEvents, actionRequired, approvalQueue.approvalGrants, approvalQueue.approvalRequests, fs.terminalRuns, persistCurrentThreadSnapshot, questionQueue.questionRequests, session.importedPlan]);

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
    terminalRuns: fs.terminalRuns,
    commandStatus: fs.commandStatus,
    viewFile: fs.viewFile,
    setWorkspaceRoot,
    refreshFileTree: fs.refreshFileTree,
    executeCommand: fs.executeCommand,
    // From useWorkspace
    threadEvents,
    emitThreadEvent,
    updateThreadEvent,
    agentEvents: [],
    actionRequired,
    pendingActions: selectPendingActions(runtimeLedgerSnapshot),
    runSteps: selectRunSteps(runtimeLedgerSnapshot),
    startCollaborationFlow: () => {
      if (session.importedPlan) {
        startCollaborationFlow(session.importedPlan);
      }
    },
    applyEventPatch: patchWorkflow.applyEventPatch,
    rollbackEventPatch: patchWorkflow.rollbackEventPatch,
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
    currentContextInspector,
    refreshCurrentContext,
    evaluateDeepSeekSmokeRun,
    writeProjectContextFile,
    questionRequests: questionQueue.questionRequests,
    pendingQuestions: questionQueue.pendingQuestions,
    answerQuestion,
    cancelQuestion,
    openNewWindow: () => windowActions.openNewWindow(fs.workspaceRoot || undefined),
    approvalRequests: approvalQueue.approvalRequests,
    pendingApprovals: approvalQueue.pendingApprovals,
    resolveApproval,
    updateApprovalGrantScope: approvalQueue.updateGrantScope,
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
    usageSnapshot: buildUsageSnapshot(fs.terminalRuns),
    threadId: threadUi.threadId,
    threadUiState: threadUi.threadUiState,
    threadList: threadUi.threadList,
    threadsByProject: threadUi.threadsByProject,
    createThread,
    switchThread,
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
