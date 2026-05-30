import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentLoopPhase, ToolCall, ToolParams } from "../domain/agentLoop";
import type { ThreadEvent } from "../domain/threadEvents";
import { AgentTurnRunner } from "./agentTurnRunner";
import type { ImportedPlanState, SessionState } from "./useSession";
import { isTauri } from "../utils/tauri";
import type { LLMProvider } from "../services/llmService";
import { optionsForReasoningEffort } from "../services/llmService";
import type { RunControlsState } from "./useRunControls";
import { createAgentRunSession, reduceAgentRunSession } from "../domain/agentRunSession";
import type { AgentRunSession } from "../domain/agentRunSession";
import type { ProjectSecurityOverride, SecuritySettings } from "../domain/types";
import type { ApprovalRequest } from "./useApprovalQueue";
import type { PermissionSchedulerResult } from "../runtime/permissionScheduler";
import type { QuestionRequest, QuestionOption } from "../domain/questionRequest";
import type { ToolCallLifecycle } from "../domain/toolCallLifecycle";
import { ToolCallExecutor, type ToolLifecycleStore } from "./toolCallExecutor";
import { AgentRunKernel } from "./agentRunKernel";
import { BuildTurnRuntime, type RuntimeEventInput } from "./buildTurnRuntime";

export { summarizeAssistantToolOutput } from "./buildTurnRuntime";

interface UseAgentRunArgs {
  importedPlan: ImportedPlanState | null;
  updateTask: SessionState["updateTask"];
  providerSettings: SessionState["providerSettings"];
  apiKeys: SessionState["apiKeys"];
  runControls: RunControlsState;
  workspaceRoot: string;
  threadId: string;
  securitySettings?: SecuritySettings;
  projectSecurityOverride?: ProjectSecurityOverride;
  requestApproval: (
    tool: string,
    params: ToolParams,
    reason?: string,
    onCreated?: (request: ApprovalRequest) => void
  ) => Promise<PermissionSchedulerResult>;
  requestQuestion: (
    question: string,
    taskId: string,
    scope?: {
      workspacePath?: string;
      threadId?: string;
      kind?: QuestionRequest["kind"];
      source?: QuestionRequest["source"];
      options?: QuestionOption[];
      allowFreeform?: boolean;
    },
    onCreated?: (request: QuestionRequest) => void
  ) => Promise<string | null>;
  cancelPendingApprovals: () => void;
  cancelPendingQuestions: () => void;
  recordTerminalResult: (input: {
    workspacePath?: string;
    threadId?: string;
    taskId: string;
    approvalId?: string;
    cwd?: string;
    command: string;
    args?: string[];
    reason?: string;
    output: string;
    exitCode?: number | null;
  }) => string;
  emitThreadEvent: (event: ThreadEvent) => void;
  updateThreadEvent: (id: string, update: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent)) => void;
  onPatchReviewRequired?: (event: ThreadEvent) => void;
  toolCallLifecycleStore: ToolLifecycleStore;
  getExtensionContext?: () => Promise<string> | string;
  initialAgentRunSession?: AgentRunSession | null;
}

export function selectAgentRunTask(input: {
  tasks: ImportedPlanState["plan"]["tasks"];
  resumeTaskId?: string | null;
  currentTaskId?: string | null;
}): { task: ImportedPlanState["plan"]["tasks"][number] | undefined; completionOnly: boolean } {
  const pendingTask = input.tasks.find(t => t.status !== "done" && t.status !== "verified");
  if (input.resumeTaskId) {
    const task = input.tasks.find(t => t.id === input.resumeTaskId);
    return { task, completionOnly: Boolean(task && !pendingTask) };
  }
  if (pendingTask) return { task: pendingTask, completionOnly: false };
  const currentTask = input.currentTaskId
    ? input.tasks.find(t => t.id === input.currentTaskId)
    : undefined;
  return {
    task: currentTask || input.tasks[0],
    completionOnly: Boolean(currentTask || input.tasks[0]),
  };
}

export function looksLikeSuccessfulVerificationResult(text?: string): boolean {
  if (!text) return false;
  return /(?:exit code|返回值)\s*0\b|校验通过|验证命令已通过|verification(?: command)? .*?(?:passed|succeeded|success)|tests?\s+passed|build\s+succeeded/i.test(text);
}

export function isUserBuildFollowUpResume(text?: string): boolean {
  return /^User follow-up instruction in Build mode:/i.test((text || "").trim());
}

export function shouldForceFinalSummaryRun(input: {
  completionOnly: boolean;
  resumeKind?: AgentRunSession["resumeKind"];
  lastToolResult?: string;
  resumeContext?: string;
}): boolean {
  if (isUserBuildFollowUpResume(input.resumeContext)) return false;
  if (looksLikeSuccessfulVerificationResult(input.lastToolResult) || looksLikeSuccessfulVerificationResult(input.resumeContext)) {
    return true;
  }
  return input.completionOnly;
}

export function useAgentRun({
  importedPlan,
  updateTask,
  providerSettings,
  apiKeys,
  runControls,
  workspaceRoot,
  threadId,
  securitySettings,
  projectSecurityOverride,
  requestApproval,
  requestQuestion,
  cancelPendingApprovals,
  cancelPendingQuestions,
  recordTerminalResult,
  emitThreadEvent,
  updateThreadEvent,
  onPatchReviewRequired,
  toolCallLifecycleStore,
  getExtensionContext,
  initialAgentRunSession,
}: UseAgentRunArgs) {
  const [agentLoopPhase, setAgentLoopPhase] = useState<AgentLoopPhase>("idle");
  const [agentLoopToolCalls, setAgentLoopToolCalls] = useState<ToolCall[]>([]);
  const [agentLoopRunning, setAgentLoopRunning] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingActive, setStreamingActive] = useState(false);
  const [agentRunSession, dispatchRunSession] = useReducer(reduceAgentRunSession, createAgentRunSession());

  const agentLoopEngineRef = useRef<AgentTurnRunner | null>(null);
  const agentLoopCancelledRef = useRef(false);
  const patchReviewPendingRef = useRef(false);
  const toolCallsRef = useRef(new Map<string, ToolCall>());
  const toolCallLifecyclesRef = useRef<ToolCallLifecycle[]>(toolCallLifecycleStore.list());
  const recoveredRef = useRef(false);
  const continueResolverRef = useRef<((shouldContinue: boolean) => void) | null>(null);
  const recoveredResumeContextRef = useRef<string | undefined>(undefined);
  const agentLoopErrorRef = useRef(false);
  const latestPhaseEventIdRef = useRef<string | null>(null);
  const agentRunKernelRef = useRef(new AgentRunKernel());

  useEffect(() => {
    toolCallLifecyclesRef.current = toolCallLifecycleStore.list();
  });

  const emitRuntimeEvent = useCallback((event: RuntimeEventInput) => {
    emitThreadEvent({
      id: event.id || `${event.kind}-${Date.now()}`,
      kind: event.kind,
      runSessionId: event.runSessionId,
      workspacePath: event.workspacePath,
      threadId: event.threadId,
      taskId: event.taskId,
      role: event.role || "planner",
      status: event.status || "done",
      title: event.title,
      message: event.message,
      timestamp: new Date().toLocaleTimeString(),
      patches: event.patches,
      question: event.question,
      planDraft: event.planDraft,
    });
  }, [emitThreadEvent]);

  useEffect(() => {
    if (!initialAgentRunSession || recoveredRef.current) return;
    recoveredRef.current = true;
    dispatchRunSession({ type: "recover", session: initialAgentRunSession });
    setAgentLoopPhase(initialAgentRunSession.phase);
  }, [initialAgentRunSession]);

  const waitForExplicitContinue = useCallback((
    resumeKind: NonNullable<AgentRunSession["resumeKind"]>,
    resumeAction: AgentRunSession["resumeAction"],
    lastToolResult: string,
  ) => {
    dispatchRunSession({ type: "pauseForContinue", resumeKind, resumeAction, lastToolResult });
    emitRuntimeEvent({
      id: `continue-wait-${Date.now()}`,
      kind: "commandExecution",
      role: "reviewer",
      title: "Waiting For Continue",
      status: "idle",
      message: "操作结果已记录。点击“继续执行”后，Agent 才会把这个结果带回模型继续下一步。",
    });
    return new Promise<boolean>((resolve) => {
      continueResolverRef.current = (shouldContinue: boolean) => {
        continueResolverRef.current = null;
        if (shouldContinue) dispatchRunSession({ type: "continue" });
        resolve(shouldContinue);
      };
    });
  }, [emitRuntimeEvent]);

  const startAgentLoop = useCallback(async () => {
    const pushGuardEvent = (message: string) => {
      emitRuntimeEvent({
        id: `guard-${Date.now()}`,
        kind: "error",
        role: "reviewer",
        title: "Run Guard",
        status: "done",
        message,
      });
    };

    const preparation = agentRunKernelRef.current.prepareBuildTurn({
      importedPlan,
      providerSettings,
      apiKeys,
      runControls,
      agentRunSession,
      workspaceRoot,
      threadId,
      recoveredResumeContext: recoveredResumeContextRef.current,
    });

    if (!preparation.ok) {
      pushGuardEvent(preparation.guard.message);
      return;
    }

    const {
      task,
      provider,
      providerId,
      model,
      runThreadId,
      runSessionId,
      isResumeRun,
      finalSummaryOnly,
      completionContext,
    } = preparation.value;

    setAgentLoopRunning(true);
    agentLoopErrorRef.current = false;
    if (isResumeRun) {
      dispatchRunSession({ type: "resume" });
    } else {
      dispatchRunSession({ type: "start", taskId: task.id, workspacePath: workspaceRoot, threadId: runThreadId, runSessionId });
    }
    agentLoopCancelledRef.current = false;
    patchReviewPendingRef.current = false;
    setAgentLoopPhase("planning");
    setAgentLoopToolCalls([]);
    toolCallsRef.current.clear();
    const toolExecutor = new ToolCallExecutor({
      list: () => toolCallLifecyclesRef.current,
      append: toolCallLifecycleStore.append,
      update: toolCallLifecycleStore.update,
    });

    if (isTauri()) {
      try {
        await invoke("create_thread", {
          id: runThreadId,
          projectId: "default",
          title: task.title || "Agent Session",
        });
      } catch {
        /* optional */
      }
    }

    const buildTurnRuntime = new BuildTurnRuntime({
      task,
      runSessionId,
      runThreadId,
      workspaceRoot,
      finalSummaryOnly,
      providerSandboxMode: providerSettings.sandboxMode,
      securitySettings,
      projectSecurityOverride,
      toolExecutor,
      toolCalls: toolCallsRef.current,
      patchReviewPending: patchReviewPendingRef,
      agentLoopCancelled: agentLoopCancelledRef,
      latestPhaseEventId: latestPhaseEventIdRef,
      emitRuntimeEvent,
      emitThreadEvent,
      updateThreadEvent,
      dispatchRunSession,
      setAgentLoopPhase,
      setAgentLoopRunning,
      setAgentLoopToolCalls,
      setStreamingContent,
      setStreamingActive,
      updateTask,
      recordTerminalResult,
      requestApproval,
      requestQuestion,
      waitForExplicitContinue,
      onPatchReviewRequired,
      getExtensionContext,
      getMaxIterations: () => providerSettings.agent?.maxIterations || 15,
      getAgentSettings: () => providerSettings.agent,
      markRuntimeError: () => {
        agentLoopErrorRef.current = true;
      },
    });
    const runner = new AgentTurnRunner(buildTurnRuntime.callbacks());

    agentLoopEngineRef.current = runner;

    const providerConfig = providerSettings.configs[providerId] || {};
    const resumeContext = completionContext || recoveredResumeContextRef.current;
    recoveredResumeContextRef.current = undefined;
    const turnResult = await runner.runBuildTurn({
        task,
        provider: providerId as LLMProvider,
        model,
        baseUrl: providerConfig.baseUrl || provider.baseUrl,
        threadId: runThreadId,
        options: optionsForReasoningEffort(runControls.selection.reasoningEffort),
        resumeContext,
    });
    if (turnResult.kind === "failed") {
      agentLoopErrorRef.current = true;
      console.error("Agent loop failed:", turnResult.error);
    }

    setAgentLoopRunning(false);
    if (agentLoopErrorRef.current && !agentLoopCancelledRef.current) {
      setAgentLoopPhase("error");
      return;
    }
    if (patchReviewPendingRef.current && !agentLoopCancelledRef.current) {
      setAgentLoopPhase("reviewing");
      return;
    }
    setAgentLoopPhase("idle");
    if (!agentLoopCancelledRef.current) {
      dispatchRunSession({ type: "complete", phase: "idle" });
    }
  }, [agentRunSession.id, agentRunSession.taskId, agentRunSession.threadId, apiKeys, emitRuntimeEvent, getExtensionContext, importedPlan, projectSecurityOverride, providerSettings.configs, providerSettings.agent, providerSettings.sandboxMode, recordTerminalResult, requestApproval, requestQuestion, runControls, securitySettings, threadId, toolCallLifecycleStore, updateTask, updateThreadEvent, waitForExplicitContinue, workspaceRoot]);

  const continueAgentRun = useCallback(() => {
    const resolve = continueResolverRef.current;
    if (resolve) {
      emitRuntimeEvent({
        id: `continue-live-${Date.now()}`,
        kind: "commandExecution",
        role: "planner",
        title: "Continue Agent",
        status: "thinking",
        message: "继续执行：已将用户操作结果交回 Agent。",
      });
      resolve(true);
      return;
    }

    if (!agentRunSession.canContinue && !agentRunSession.resumeKind) return;
    recoveredResumeContextRef.current = agentRunSession.lastToolResult;
    dispatchRunSession({ type: "continue" });
    emitRuntimeEvent({
      id: `continue-recovered-${Date.now()}`,
      kind: "commandExecution",
      role: "planner",
      title: "Continue Agent",
      status: "thinking",
      message: "继续执行恢复的任务。Orbit 会使用上次等待操作的结果和当前任务上下文继续，不会自动跳过审批。",
    });
    void startAgentLoop();
  }, [agentRunSession.canContinue, agentRunSession.resumeKind, agentRunSession.lastToolResult, emitRuntimeEvent, startAgentLoop]);

  const submitBuildMessage = useCallback((message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return false;
    const activeTask = agentRunSession.taskId
      ? importedPlan?.plan.tasks.find((task) => task.id === agentRunSession.taskId)
      : importedPlan?.plan.tasks.find((task) => task.status !== "done" && task.status !== "verified") || importedPlan?.plan.tasks[0];
    if (!activeTask) {
      emitRuntimeEvent({
        id: `build-message-no-task-${Date.now()}`,
        kind: "agentMessage",
        workspacePath: workspaceRoot,
        threadId,
        role: "planner",
        title: "Build Message",
        status: "done",
        message: "Build 模式收到了补充指令，但当前没有可继续的任务。请先导入计划。",
      });
      return false;
    }

    emitRuntimeEvent({
      id: `user-build-message-${Date.now()}`,
      kind: "userMessage",
      workspacePath: workspaceRoot,
      threadId,
      taskId: activeTask.id,
      role: "planner",
      title: "User Instruction",
      status: "done",
      message: trimmed,
    });

    recoveredResumeContextRef.current = [
      "User follow-up instruction in Build mode:",
      trimmed,
      "",
      "Continue the current task with this instruction. Do not import this text as a new plan. Do not replace the current Coding Plan.",
      "If the user reports that no patch proposal exists, produce a strict propose_patch tool call before claiming a patch was proposed.",
    ].join("\n");

    if (!agentLoopRunning) {
      void startAgentLoop();
    } else {
      emitRuntimeEvent({
        id: `build-message-queued-${Date.now()}`,
        kind: "agentMessage",
        workspacePath: workspaceRoot,
        threadId,
        taskId: activeTask.id,
        role: "planner",
        title: "Instruction Queued",
        status: "idle",
        message: "补充指令已记录。当前 Agent 正在运行；如需要中断，请取消后重新继续。",
      });
    }
    return true;
  }, [agentLoopRunning, agentRunSession.taskId, emitRuntimeEvent, importedPlan?.plan.tasks, startAgentLoop, threadId, workspaceRoot]);

  const markPatchAppliedForContinue = useCallback((eventId: string, details?: string) => {
    dispatchRunSession({
      type: "pauseForContinue",
      resumeKind: "patchReview",
      resumeAction: { type: "patchReview", payloadId: eventId },
      lastToolResult: [
        `Patch proposal ${eventId} was applied transactionally to the workspace.`,
        details,
        "A verification command approval may already be pending in Orbit.",
        "Do not duplicate the same patch or verification approval; continue from this applied-patch state.",
      ].filter(Boolean).join(" "),
    });
    emitRuntimeEvent({
      id: `continue-patch-${Date.now()}`,
      kind: "commandExecution",
      role: "reviewer",
      title: "Waiting For Continue",
      status: "idle",
      message: "补丁已事务写入。验证命令已进入中心授权队列；点击“继续执行”后，Agent 会把 Patch 已应用的结果纳入下一步。",
    });
  }, [emitRuntimeEvent]);

  const markVerificationCompletedForContinue = useCallback((taskId: string, exitCode: number | null, outputSnippet?: string, scope?: { workspacePath?: string; threadId?: string }) => {
    if (!agentRunSession.taskId || agentRunSession.taskId !== taskId) return;
    if (scope?.workspacePath && agentRunSession.workspacePath && scope.workspacePath !== agentRunSession.workspacePath) return;
    if (scope?.threadId && agentRunSession.threadId && scope.threadId !== agentRunSession.threadId) return;
    dispatchRunSession({
      type: "pauseForContinue",
      resumeKind: "verification",
      resumeAction: { type: "verification", payloadId: taskId },
      lastToolResult: [
        `Verification command for task ${taskId} finished with exit code ${exitCode ?? "unknown"}.`,
        outputSnippet ? `Terminal output tail:\n${outputSnippet}` : "",
        "Continue from this terminal result; summarize success or propose the next fix without rerunning the same command unless needed.",
      ].filter(Boolean).join("\n"),
    });
    emitRuntimeEvent({
      id: `continue-verification-${Date.now()}`,
      kind: "verification",
      role: "verifier",
      title: "Waiting For Continue",
      status: "idle",
      message: exitCode === 0
        ? "验证命令已通过。点击“继续执行”后，Agent 会生成最终总结或进入下一步。"
        : "验证命令未通过。点击“继续执行”后，Agent 会读取失败结果并重新规划修复。",
    });
  }, [agentRunSession.taskId, agentRunSession.threadId, agentRunSession.workspacePath, emitRuntimeEvent]);

  const markRecoveredActionForContinue = useCallback((
    resumeKind: NonNullable<AgentRunSession["resumeKind"]>,
    resumeAction: AgentRunSession["resumeAction"],
    lastToolResult: string,
    message: string,
  ) => {
    dispatchRunSession({
      type: "pauseForContinue",
      resumeKind,
      resumeAction,
      lastToolResult,
    });
    emitRuntimeEvent({
      id: `continue-recovered-action-${Date.now()}`,
      kind: "commandExecution",
      workspacePath: agentRunSession.workspacePath,
      threadId: agentRunSession.threadId,
      taskId: agentRunSession.taskId || undefined,
      role: "reviewer",
      title: "Waiting For Continue",
      status: "idle",
      message,
    });
  }, [agentRunSession.taskId, agentRunSession.threadId, agentRunSession.workspacePath, emitRuntimeEvent]);

  const cancelAgentLoop = useCallback(() => {
    agentLoopCancelledRef.current = true;
    setAgentLoopRunning(false);
    setAgentLoopPhase("cancelled");
    dispatchRunSession({ type: "complete", phase: "cancelled" });
    setStreamingActive(false);
    setStreamingContent("");
    cancelPendingApprovals();
    cancelPendingQuestions();
    continueResolverRef.current?.(false);
    continueResolverRef.current = null;
    agentLoopEngineRef.current?.cancel();
  }, [cancelPendingApprovals, cancelPendingQuestions]);

  const recoverAgentRunSession = useCallback((session: AgentRunSession | null) => {
    const nextSession = session ?? createAgentRunSession();
    dispatchRunSession({ type: "recover", session: nextSession });
    setAgentLoopPhase(nextSession.phase);
    setAgentLoopRunning(false);
    setStreamingActive(false);
    setStreamingContent("");
    continueResolverRef.current?.(false);
    continueResolverRef.current = null;
    recoveredRef.current = Boolean(session);
  }, []);

  return {
    agentLoopPhase,
    agentLoopToolCalls,
    agentLoopRunning,
    startAgentLoop,
    continueAgentRun,
    submitBuildMessage,
    markPatchAppliedForContinue,
    markVerificationCompletedForContinue,
    markRecoveredActionForContinue,
    recoverAgentRunSession,
    cancelAgentLoop,
    streamingContent,
    streamingActive,
    agentRunSession,
  };
}
