import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "../domain/agentEvents";
import type { PermissionAction, PermissionDecision, PermissionPreset, ProjectSecurityOverride } from "../domain/types";
import { mergeRunSteps } from "../domain/runSteps";
import { sessionStore } from "../storage/sessionStore";
import { callLLMApi, CODER_SYSTEM_PROMPT } from "../services/llmService";
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
import { formatCommandForDisplay, parseCommandLine } from "../runtime/commandParser";
import { buildEffectiveSecurityPolicy } from "../runtime/securityPolicy";
import { buildUsageSnapshot } from "./usageSnapshot";
import { buildReviewDockModel } from "../features/review/reviewDockModel";
import type { ApprovalRequest } from "./useApprovalQueue";

export type { AgentEvent } from "../domain/agentEvents";
export type { ImportedPlanState, ImportErrorState, ProviderSettings } from "./useSession";

export function useWorkspace() {
  const session = useSession();

  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [healingAttempts, setHealingAttempts] = useState<Record<string, number>>({});

  const agentEventsRef = useRef(agentEvents);
  const isRealLLMActiveRef = useRef(session.isRealLLMActive);
  const activeLLMConfigRef = useRef(session.activeLLMConfig);
  const healingAttemptsRef = useRef(healingAttempts);
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const restoredWaitNoticeRef = useRef(false);
  const restoredRecentWorkspaceRef = useRef(false);

  useEffect(() => { agentEventsRef.current = agentEvents; }, [agentEvents]);
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
    if (session.loadedAgentEvents && session.loadedAgentEvents.length > 0 && agentEvents.length === 0) {
      setAgentEvents(session.loadedAgentEvents as AgentEvent[]);
    }
  }, [session.loadedAgentEvents]);

  const addAgentEvent = useCallback((event: AgentEvent) => {
    setAgentEvents((prev) => [...prev, event]);
  }, []);

  const embeddingIndex = useEmbeddingIndex({ onEvent: addAgentEvent });
  const windowActions = useWindowActions();
  const approvalQueue = useApprovalQueue();
  const questionQueue = useQuestionQueue();
  const projectStore = useProjectStore();
  const layout = useLayoutPreferences();
  const projectActions = useProjectActions(projectStore.recentProjects);
  const runControls = useRunControls(session.providerSettings, session.apiKeys);

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

  const startCollaborationFlow = useCallback(async (plan: ImportedPlanState) => {
    const task = plan?.plan.tasks.find(t => t.status !== "done" && t.status !== "verified");
    setAgentEvents(task ? [{
      id: `ready-${Date.now()}`,
      role: "planner",
      name: "Plan Ready",
      status: "idle",
      message: `计划已导入，当前待处理任务：[${task.title}]。Plan 模式只更新任务；切换 Build 后才会启动 Agent、进入审批、提出 Patch 并等待 Diff 审查。`,
      timestamp: new Date().toLocaleTimeString(),
    }] : []);
  }, []);

  useEffect(() => {
    if (session.importedPlan && !session.isLoading && (!session.loadedAgentEvents || session.loadedAgentEvents.length === 0)) {
      startCollaborationFlow(session.importedPlan);
    }
  }, [session.importedPlan?.plan?.title, session.isLoading, session.loadedAgentEvents, startCollaborationFlow]);

  const terminalLogsRef = useRef<Record<string, string>>({});

  const triggerSelfHealing = useCallback(async (taskId: string, exitCode: number | null) => {
    if (!session.providerSettings.agent?.autoSelfHeal || !isRealLLMActiveRef.current || !activeLLMConfigRef.current) return;

    const attempt = healingAttemptsRef.current[taskId] || 0;
    if (attempt >= 3) {
      setAgentEvents(prev => prev.map(e => {
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

    const currentEvents = agentEventsRef.current;
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

    setAgentEvents(prev => {
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
        role: "coder",
        name: "Self-Healing Coder",
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

      setAgentEvents(prev => {
        const next = [...prev];
        const healIdx = next.findIndex(e => e.id.startsWith("healing-") && e.status === "thinking");
        if (healIdx !== -1) {
          next[healIdx] = {
            ...next[healIdx],
            status: "done",
            message: `自愈代码补丁已成功生成。我已修复了 [${filePath}](file://./${filePath}) 中导致测试失败的逻辑错误。请重新审查新 Patch。`,
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
      setAgentEvents(prev => {
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

  const handleCommandComplete = useCallback((taskId: string, exitCode: number | null) => {
    if (exitCode === 0) {
      setAgentEvents(prev => prev.map(e => {
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
        setAgentEvents(prev => prev.map(e => {
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
  }, [triggerSelfHealing]);

  const fs = useFileSystem(session.providerSettings, session.updateTask, handleCommandComplete, session.loadedTerminalRuns || []);
  const threadUi = useThreadUiState(fs.workspaceRoot, session.activeTitle || "default-thread");

  useEffect(() => {
    const resumeKind = session.loadedAgentRunSession?.resumeKind;
    if (!resumeKind || restoredWaitNoticeRef.current) return;
    const existingEvents = (session.loadedAgentEvents as AgentEvent[] | null | undefined) || agentEventsRef.current;
    const alreadyNoted = existingEvents.some((event) =>
      event.name === "Recovered Waiting State" && event.message.includes(`：${resumeKind}`)
    );
    if (alreadyNoted) {
      restoredWaitNoticeRef.current = true;
      return;
    }
    restoredWaitNoticeRef.current = true;
    addAgentEvent({
      id: `resume-${Date.now()}`,
      role: "reviewer",
      name: "Recovered Waiting State",
      status: "idle",
      message: `已恢复上次未完成的等待操作：${resumeKind}。请在 Review Dock 中继续处理。`,
      timestamp: new Date().toLocaleTimeString(),
    });
  }, [addAgentEvent, session.loadedAgentEvents, session.loadedAgentRunSession?.resumeKind]);

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
    const ok = await fs.setWorkspaceRoot(path);
    if (ok) {
      await projectStore.rememberProject(path);
    }
    return ok;
  }, [fs, projectStore]);

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

  const requestPostPatchVerification = useCallback((eventId: string) => {
    const task = session.importedPlan?.plan.tasks.find(t => t.status !== "done" && t.status !== "verified" && t.verification?.some(Boolean))
      ?? session.importedPlan?.plan.tasks.find(t => t.verification?.some(Boolean));
    const rawCommand = task?.verification?.find(Boolean);
    if (!task || !rawCommand) {
      addAgentEvent({
        id: `verify-missing-${Date.now()}`,
        role: "verifier",
        name: "Verification",
        status: "idle",
        message: "Patch 已写入。当前任务没有配置验证命令，请手动检查结果。",
        timestamp: new Date().toLocaleTimeString(),
      });
      return;
    }

    const parsed = parseCommandLine(rawCommand);
    if (!parsed) return;
    const displayCommand = formatCommandForDisplay(parsed.command, parsed.args);
    const reason = `Patch ${eventId} 已写入，运行验证命令确认当前任务：${task.title}`;

    addAgentEvent({
      id: `verify-request-${Date.now()}`,
      role: "verifier",
      name: "Verification Approval",
      status: "thinking",
      message: `补丁已事务写入。等待你批准验证命令：${displayCommand}`,
      timestamp: new Date().toLocaleTimeString(),
    });

    approvalQueue.requestApproval("run_command", {
      command: parsed.command,
      args: parsed.args,
      reason,
      taskId: task.id,
      sourceEventId: eventId,
      workspacePath: fs.workspaceRoot,
    }, reason).then((approved) => {
      if (!approved) {
        addAgentEvent({
          id: `verify-denied-${Date.now()}`,
          role: "verifier",
          name: "Verification Denied",
          status: "done",
          message: `你拒绝了验证命令：${displayCommand}。Agent 不会自动运行测试。`,
          timestamp: new Date().toLocaleTimeString(),
        });
        return;
      }
      fs.executeCommand(task.id, displayCommand);
    });
  }, [addAgentEvent, approvalQueue, fs, session.importedPlan]);

  const patchWorkflow = usePatchWorkflow({
    agentEventsRef,
    setAgentEvents,
    fs,
    isRealLLMActiveRef,
    activeLLMConfigRef,
    onPatchApplied: requestPostPatchVerification,
  });

  const agentRun = useAgentRun({
    importedPlan: session.importedPlan,
    updateTask: session.updateTask,
    providerSettings: session.providerSettings,
    apiKeys: session.apiKeys,
    runControls,
    workspaceRoot: fs.workspaceRoot,
    securitySettings: session.providerSettings.security,
    projectSecurityOverride,
    requestApproval: approvalQueue.requestApproval,
    cancelPendingApprovals: approvalQueue.cancelPendingApprovals,
    requestQuestion: questionQueue.requestQuestion,
    cancelPendingQuestions: questionQueue.cancelPendingQuestions,
    recordTerminalResult: fs.recordTerminalResult,
    setAgentEvents,
    initialAgentRunSession: session.loadedAgentRunSession,
  });

  const reviewDockModel = useMemo(() => buildReviewDockModel({
    approvals: approvalQueue.approvalRequests,
    questions: questionQueue.questionRequests,
    events: agentEvents,
    terminalRuns: fs.terminalRuns,
  }), [agentEvents, approvalQueue.approvalRequests, fs.terminalRuns, questionQueue.questionRequests]);

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

    addAgentEvent({
      id: `recovered-approval-${Date.now()}`,
      role: "reviewer",
      name: approved ? "Recovered Approval Granted" : "Recovered Approval Denied",
      status: "done",
      message: approved
        ? `你已批准恢复的 ${tool} 操作。`
        : `你已拒绝恢复的 ${tool} 操作。`,
      timestamp: new Date().toLocaleTimeString(),
    });

    if (!approved || tool !== "run_command" || !command) return;
    fs.executeStructuredCommand({
      taskId,
      command,
      args,
      reason,
      workspacePath,
    });
  }, [addAgentEvent, agentRun.agentRunSession.taskId, fs, session.importedPlan?.plan.tasks]);

  const resolveApproval = useCallback((id: string, approved: boolean) => {
    const request = approvalQueue.approvalRequests.find((item) => item.id === id);
    const hadLiveResolver = approvalQueue.resolveApproval(id, approved);
    if (!request || hadLiveResolver) return;
    resolveRecoveredApprovalAction(request, approved);
  }, [approvalQueue, resolveRecoveredApprovalAction]);

  const answerQuestion = useCallback((id: string, answer: string) => {
    const question = questionQueue.questionRequests.find((item) => item.id === id);
    const hadLiveResolver = questionQueue.answerQuestion(id, answer);
    if (!question || hadLiveResolver) return;
    addAgentEvent({
      id: `recovered-question-${Date.now()}`,
      role: "planner",
      name: "Recovered Question Answered",
      status: "done",
      message: `你已回答恢复的问题：${answer}`,
      timestamp: new Date().toLocaleTimeString(),
    });
  }, [addAgentEvent, questionQueue]);

  const cancelQuestion = useCallback((id: string) => {
    const question = questionQueue.questionRequests.find((item) => item.id === id);
    const hadLiveResolver = questionQueue.cancelQuestion(id);
    if (!question || hadLiveResolver) return;
    addAgentEvent({
      id: `recovered-question-cancel-${Date.now()}`,
      role: "planner",
      name: "Recovered Question Cancelled",
      status: "done",
      message: "你取消了恢复的问题。",
      timestamp: new Date().toLocaleTimeString(),
    });
  }, [addAgentEvent, questionQueue]);

  useEffect(() => {
    if (session.isLoading) return;
    const timer = setTimeout(() => {
      sessionStore.saveSession({
        activeProjectId: "default",
        activeThreadId: "default",
        importedPlan: session.importedPlan,
        providerSettings: session.providerSettings,
        agentEvents,
        agentRunSession: agentRun.agentRunSession,
        approvalRequests: approvalQueue.approvalRequests,
        questionRequests: questionQueue.questionRequests,
        terminalRuns: fs.terminalRuns,
        lastActiveAt: new Date().toISOString(),
      }).catch(console.error);
    }, 2000);
    return () => clearTimeout(timer);
  }, [session.importedPlan, session.providerSettings, agentEvents, agentRun.agentRunSession, approvalQueue.approvalRequests, questionQueue.questionRequests, fs.terminalRuns, session.isLoading]);

  return {
    // From session
    isLoading: session.isLoading,
    importedPlan: session.importedPlan,
    importError: session.importError,
    providerSettings: session.providerSettings,
    apiKeys: session.apiKeys,
    isRealLLMActive: session.isRealLLMActive,
    activeLLMConfig: session.activeLLMConfig,
    runControls,
    activeTitle: session.activeTitle,
    outputFiles: session.outputFiles,
    importPlan: session.importPlan,
    clearImportedPlan: () => {
      session.clearImportedPlan();
      setAgentEvents([]);
    },
    updateTask: session.updateTask,
    addTask: session.addTask,
    deleteTask: session.deleteTask,
    moveTask: session.moveTask,
    updateProviderSettings: session.updateProviderSettings,
    updateApiKey: session.updateApiKey,
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
    agentEvents,
    runSteps: mergeRunSteps(agentEvents, approvalQueue.approvalRequests),
    startCollaborationFlow: () => {
      if (session.importedPlan) {
        startCollaborationFlow(session.importedPlan);
      }
    },
    applyEventPatch: patchWorkflow.applyEventPatch,
    refinePatch: patchWorkflow.refinePatch,
    updateEventPatch: patchWorkflow.updateEventPatch,
    agentLoopPhase: agentRun.agentLoopPhase,
    agentLoopToolCalls: agentRun.agentLoopToolCalls,
    agentLoopRunning: agentRun.agentLoopRunning,
    startAgentLoop: agentRun.startAgentLoop,
    cancelAgentLoop: agentRun.cancelAgentLoop,
    buildEmbeddings: embeddingIndex.buildEmbeddings,
    embeddingBuildProgress: embeddingIndex.embeddingBuildProgress,
    streamingContent: agentRun.streamingContent,
    streamingActive: agentRun.streamingActive,
    agentRunSession: agentRun.agentRunSession,
    reviewDockModel,
    questionRequests: questionQueue.questionRequests,
    pendingQuestions: questionQueue.pendingQuestions,
    answerQuestion,
    cancelQuestion,
    openNewWindow: () => windowActions.openNewWindow(fs.workspaceRoot || undefined),
    approvalRequests: approvalQueue.approvalRequests,
    pendingApprovals: approvalQueue.pendingApprovals,
    resolveApproval,
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
    updateThreadUiState: threadUi.updateThreadUiState,
    togglePinnedThread: threadUi.togglePinnedThread,
    renameThread: threadUi.renameThread,
    archiveThread: threadUi.archiveThread,
  };
}
