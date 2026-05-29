import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentLoopPhase, ToolCall, ToolParams } from "../domain/agentLoop";
import type { ThreadEvent } from "../domain/threadEvents";
import { stripFabricatedToolResults } from "./agentLoopEngine";
import { BuildAgentEngine } from "./buildAgentEngine";
import { normalizePatchProposal } from "./patchWorkflow";
import type { PatchItem } from "./patchWorkflow";
import type { ImportedPlanState, SessionState } from "./useSession";
import { isTauri } from "../utils/tauri";
import type { LLMProvider } from "../services/llmService";
import { optionsForReasoningEffort } from "../services/llmService";
import type { RunControlsState } from "./useRunControls";
import { createAgentRunSession, reduceAgentRunSession } from "../domain/agentRunSession";
import type { AgentRunSession } from "../domain/agentRunSession";
import type { ContextCompactionState, ProjectSecurityOverride, SecuritySettings } from "../domain/types";
import type { ApprovalRequest } from "./useApprovalQueue";
import type { PermissionSchedulerResult } from "../runtime/permissionScheduler";
import { normalizeQuestionOptions, type QuestionRequest, type QuestionOption } from "../domain/questionRequest";
import { looksLikeNonStrictPatchProposal, parseToolEnvelopes } from "../domain/agentToolEnvelope";
import { invokeDesktop, isDesktopRuntime } from "../runtime/desktopGateway";
import type { ToolCallLifecycle } from "../domain/toolCallLifecycle";
import {
  summarizeToolParamsForLifecycle,
  ToolCallExecutor,
  type ToolLifecycleStore,
} from "./toolCallExecutor";
import { AgentRunKernel } from "./agentRunKernel";

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

type RuntimeEventInput = Omit<ThreadEvent, "id" | "timestamp" | "kind" | "role" | "status" | "title" | "message"> & {
  id?: string;
  kind: ThreadEvent["kind"];
  role?: ThreadEvent["role"];
  status?: ThreadEvent["status"];
  title: string;
  message: string;
};

function toolDisplayName(tool: string): string {
  if (tool === "run_command") return "命令";
  if (tool === "apply_patch" || tool === "propose_patch") return "补丁";
  if (tool === "ask_user") return "问题";
  if (tool === "read_file") return "读取文件";
  if (tool === "search_code") return "搜索代码";
  if (tool === "list_files") return "列出文件";
  return tool;
}

function compactPhaseMessage(message: string): string {
  const toolMatch = message.match(/(?:Executing|Running):\s*([a-z_]+)/i);
  if (toolMatch) return `正在处理：${toolDisplayName(toolMatch[1])}`;
  const approvalMatch = message.match(/^(run_command|apply_patch|propose_patch|ask_user|read_file|search_code|list_files):/);
  if (approvalMatch) return `等待中心操作确认：${toolDisplayName(approvalMatch[1])}`;
  return message;
}

function approvalEventMessage(tool: string, params: ToolParams): string {
  if (tool === "run_command") {
    const command = typeof params.command === "string" ? params.command : "command";
    const args = Array.isArray(params.args) ? params.args.filter((arg): arg is string => typeof arg === "string") : [];
    const reason = typeof params.reason === "string" && params.reason.trim() ? `。原因：${params.reason}` : "";
    return `等待你在中心授权命令：${[command, ...args].join(" ")}${reason}`;
  }
  if (tool === "apply_patch" || tool === "propose_patch") return "等待你在中心审查补丁。批准后才会写入当前工作区。";
  return `等待你在中心确认：${toolDisplayName(tool)}`;
}

export function summarizeAssistantToolOutput(content: string): string | null {
  const parsed = parseToolEnvelopes(content);
  if (parsed.envelopes.length === 0) return null;

  const envelope = parsed.envelopes[0];
  if (envelope.tool === "run_command") {
    const command = typeof envelope.params.command === "string" ? envelope.params.command : "command";
    const args = Array.isArray(envelope.params.args) ? envelope.params.args.filter((arg): arg is string => typeof arg === "string") : [];
    const reason = typeof envelope.params.reason === "string" ? envelope.params.reason : "";
    return `Agent 请求运行命令：${[command, ...args].join(" ")}${reason ? `。原因：${reason}` : ""}`;
  }
  if (envelope.tool === "apply_patch" || envelope.tool === "propose_patch") {
    const patches = Array.isArray(envelope.params.patches) ? envelope.params.patches : [];
    const files = patches
      .map((patch) => typeof patch === "object" && patch && "path" in patch ? String((patch as { path?: unknown }).path || "") : "")
      .filter(Boolean);
    return `Agent 提出补丁审查：${files.length || patches.length} 个文件${files.length ? `（${files.slice(0, 3).join("、")}${files.length > 3 ? " 等" : ""}）` : ""}`;
  }
  if (envelope.tool === "ask_user") {
    const question = typeof envelope.params.question === "string" ? envelope.params.question : "需要用户确认";
    return `Agent 正在询问：${question}`;
  }
  if (envelope.tool === "read_file") {
    return `Agent 准备读取文件：${typeof envelope.params.path === "string" ? envelope.params.path : ""}`;
  }
  if (envelope.tool === "search_code") {
    const query = typeof envelope.params.query === "string" ? envelope.params.query : envelope.params.pattern;
    return `Agent 准备搜索代码：${typeof query === "string" ? query : ""}`;
  }
  if (envelope.tool === "list_files") return "Agent 准备读取项目文件列表";
  if (envelope.tool === "done" || envelope.tool === "done_build" || envelope.tool === "done_plan") {
    return typeof envelope.params.summary === "string" ? envelope.params.summary : "Agent 已完成当前任务。";
  }
  return null;
}

interface SandboxPreviewResult {
  id: string;
  proposal_id: string;
  sandbox_path: string;
  status: "sandboxed" | "failed";
  output: string;
  created_at: string;
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

async function previewPatchesInSandbox(
  proposalId: string,
  patches: PatchItem[],
  workspaceRoot: string,
): Promise<PatchItem[]> {
  if (!isDesktopRuntime()) {
    return patches.map((patch) => ({
      ...patch,
      sandboxStatus: "sandboxed",
      sandboxPath: "browser-fixture",
      sandboxOutput: "Browser fixture sandbox preview completed. No workspace files were changed.",
      applyStatus: "proposed",
    }));
  }

  try {
    const preview = await invokeDesktop<SandboxPreviewResult>("preview_workspace_patches_in_sandbox", {
      workspacePath: workspaceRoot,
      proposalId,
      patches: patches.map((patch) => ({
        path: patch.path,
        old_content: patch.oldContent,
        new_content: patch.newContent,
      })),
    });

    return patches.map((patch) => ({
      ...patch,
      sandboxStatus: preview.status,
      sandboxPath: preview.sandbox_path,
      sandboxOutput: preview.output,
      applyStatus: "proposed",
    }));
  } catch (error) {
    return patches.map((patch) => ({
      ...patch,
      sandboxStatus: "failed",
      sandboxOutput: error instanceof Error ? error.message : String(error),
      applyStatus: "failed",
    }));
  }
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

  const agentLoopEngineRef = useRef<BuildAgentEngine | null>(null);
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

    const engine = new BuildAgentEngine({
      onPhaseChange: (phase, message) => {
        setAgentLoopPhase(phase);
        dispatchRunSession({ type: "phase", phase });
        const eventId = `loop-${Date.now()}`;
        latestPhaseEventIdRef.current = eventId;
        emitRuntimeEvent({
          id: eventId,
          kind: "reasoningSummary",
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: phase === "implementing" ? "coder" : phase === "reviewing" ? "reviewer" : phase === "verifying" ? "verifier" : "planner",
          title: `Agent (${phase})`,
          status: phase === "done" || phase === "error" ? "done" : "thinking",
          message: compactPhaseMessage(message),
        });
      },
      onIteration: (iteration, conversationSummary) => {
        dispatchRunSession({ type: "iteration", iteration, conversationSummary });
      },
      onToolCall: (toolCall) => {
        toolCallsRef.current.set(toolCall.id, toolCall);
        dispatchRunSession({ type: "tool", toolCall });
        setAgentLoopToolCalls(prev => {
          const next = prev.filter((item) => item.id !== toolCall.id);
          return [...next, toolCall];
        });
        toolExecutor.recordGenerated(toolCall, summarizeToolParamsForLifecycle(toolCall.name, toolCall.params));
      },
      onToolResult: (id, result) => {
        const toolCall = toolCallsRef.current.get(id);
        if (toolCall?.name === "run_command") {
          const command = typeof toolCall.params.command === "string" ? toolCall.params.command : "command";
          const args = Array.isArray(toolCall.params.args) ? toolCall.params.args.filter((arg): arg is string => typeof arg === "string") : [];
          const exitCodeMatch = result.match(/\[exit_code:\s*(-?\d+)\]/);
          const terminalRunId = recordTerminalResult({
            workspacePath: workspaceRoot,
            threadId: runThreadId,
            taskId: task.id,
            cwd: typeof toolCall.params.cwd === "string" ? toolCall.params.cwd : undefined,
            command,
            args,
            reason: typeof toolCall.params.reason === "string" ? toolCall.params.reason : "Agent command result",
            output: result,
            exitCode: exitCodeMatch ? Number(exitCodeMatch[1]) : null,
          });
          dispatchRunSession({ type: "terminal", terminalRunId });
        }
        setAgentLoopToolCalls(prev => prev.map(toolCall =>
          toolCall.id === id
            ? { ...toolCall, result, status: "done", completedAt: new Date().toISOString() }
            : toolCall
        ));
        toolExecutor.recordResult(id, result);
      },
      onRequestApproval: async (tool, params) => {
        if (["read_file", "list_files", "search_code"].includes(tool)) return true;
        if (finalSummaryOnly) {
          emitRuntimeEvent({
            id: `completion-guard-${Date.now()}`,
            kind: "toolDeniedByMode",
            runSessionId,
            workspacePath: workspaceRoot,
            threadId: runThreadId,
            taskId: task.id,
            role: "reviewer",
            title: "Run Guard",
            status: "done",
            message: `当前计划已完成或已验证，这次运行只用于生成最终总结。Orbit 已拒绝新的 ${tool} 请求；请让 Agent 返回 done 总结。`,
          });
          return { approved: false, toolResult: `Denied ${tool}: final-summary-only run cannot execute additional tools.` };
        }
        const reason = typeof params.reason === "string" ? params.reason : "";
        const approvalParams: ToolParams = {
          ...params,
          taskId: task.id,
          threadId: runThreadId,
          workspacePath: workspaceRoot,
        };
        emitRuntimeEvent({
          id: `approval-${Date.now()}`,
          kind: "approval",
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "reviewer",
          title: "Approval Gate",
          status: "thinking",
          message: approvalEventMessage(tool, approvalParams),
        });
        let approvalId = "";
        const approval = await requestApproval(tool, approvalParams, reason, (request) => {
          approvalId = request.id;
          dispatchRunSession({ type: "approval", approvalId: request.id });
        });
        dispatchRunSession({ type: "approval", approvalId: undefined });
        if (typeof approvalParams.toolCallId === "string") {
          toolExecutor.recordApprovalResult({
            toolCallId: approvalParams.toolCallId,
            approval,
          });
        }
        emitRuntimeEvent({
          id: `approval-result-${Date.now()}`,
          kind: "approval",
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "reviewer",
          title: approval.approved ? "Approval Granted" : "Approval Denied",
          status: "done",
          message: approval.approved
            ? `你已批准 ${tool}。结果已记录，点击“继续执行”后 Agent 才会继续。`
            : `你已拒绝 ${tool}，Agent 将把拒绝结果纳入下一步规划。`,
        });
        const shouldContinue = await waitForExplicitContinue(
          "approval",
          { type: "approval", payloadId: approvalId },
          approval.toolResult,
        );
        if (!shouldContinue) return { ...approval, approved: false, toolResult: "Cancelled by user before resuming the agent." };
        return approval;
      },
      onToolDeniedByMode: (tool, mode) => {
        emitRuntimeEvent({
          id: `mode-denied-${Date.now()}`,
          kind: "toolDeniedByMode",
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "reviewer",
          title: "Tool Denied By Mode",
          status: "done",
          message: `${mode === "plan" ? "Plan" : "Build"} 模式拒绝了工具 ${tool}。当前模式只能使用已注册的工具。`,
        });
      },
      onAskUser: async (question, params) => {
        if (!patchReviewPendingRef.current && /(patch|diff|补丁|审查台|review|apply)/i.test(question)) {
          return [
            "No patch proposal is currently available in Orbit.",
            "You must call propose_patch with the actual file changes before asking the user to review or apply patches.",
            "Do not install dependencies or run verification until a real patch proposal exists and the user applies it.",
          ].join("\n");
        }
        const options = normalizeQuestionOptions(params.options);
        const allowFreeform = params.allowFreeform === true;
        let questionId = "";
        const answer = await requestQuestion(question, task.id, {
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          source: "agent",
          kind: options.length > 0 ? "singleChoice" : "text",
          options,
          allowFreeform,
        }, (request) => {
          questionId = request.id;
          emitRuntimeEvent({
            id: `question-${Date.now()}`,
            kind: "question",
            runSessionId,
            workspacePath: workspaceRoot,
            threadId: runThreadId,
            taskId: task.id,
            role: "planner",
            title: "Question",
            status: "thinking",
            message: options.length > 0
              ? `Agent 正在等待你的选择：${question}`
              : `Agent 正在等待你的回答：${question}`,
            question: {
              requestId: request.id,
              question,
              status: "pending",
              options,
            },
          });
          dispatchRunSession({ type: "question", questionId: request.id });
        });
        dispatchRunSession({ type: "question", questionId: undefined });
        emitRuntimeEvent({
          id: `question-result-${Date.now()}`,
          kind: "question",
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "planner",
          title: answer ? "Question Answered" : "Question Cancelled",
          status: "done",
          message: answer
            ? `你已回答 Agent 的问题：${answer}。点击“继续执行”后 Agent 才会继续。`
            : "你取消了 Agent 的问题，Agent 会收到取消结果。",
          question: {
            requestId: questionId,
            question,
            status: answer ? "answered" : "cancelled",
            answer: answer || undefined,
            options,
          },
        });
        const shouldContinue = await waitForExplicitContinue(
          "question",
          { type: "question", payloadId: questionId },
          answer ? `User answered: ${answer}` : "User cancelled question.",
        );
        if (!shouldContinue) return null;
        return answer;
      },
      onPatchProposed: async (params) => {
        if (finalSummaryOnly) {
          return [
            "Invalid propose_patch for this run: the current plan is already marked done or verified.",
            "This Orbit run is a completion-summary pass only.",
            "Do not generate patches, do not request commands, and do not rerun verification.",
            'Return exactly: {"tool":"done_build","params":{"summary":"truthful final summary based on the existing successful verification results"}}',
          ].join("\n");
        }
        const patches = normalizePatchProposal(params);
        if (patches.length === 0) return "No valid patches were proposed.";

        const hydratedPatches = await Promise.all(patches.map(async (patch) => {
          if (patch.oldContent || !isDesktopRuntime()) return patch;
          try {
            const oldContent = await invokeDesktop<string>("read_workspace_file", {
              path: patch.path,
              workspacePath: workspaceRoot,
            });
            return { ...patch, oldContent };
          } catch {
            return patch;
          }
        }));

        const eventId = `patch-${Date.now()}`;
        const sandboxedPatches = await previewPatchesInSandbox(eventId, hydratedPatches, workspaceRoot);
        const sandboxFailed = sandboxedPatches.some((patch) => patch.sandboxStatus === "failed");
        patchReviewPendingRef.current = true;
        dispatchRunSession({ type: "patch", patchProposalId: eventId });
        const patchEvent: ThreadEvent = {
          id: eventId,
          kind: "patchProposal",
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "coder",
          title: "Patch Proposal",
          status: "done",
          message: sandboxFailed
            ? `Agent 提出了 ${sandboxedPatches.length} 个文件修改，但沙盒预演失败。当前工作区没有被修改，请在详情中查看原因。`
            : `Agent 提出了 ${sandboxedPatches.length} 个文件修改，已在临时沙盒中预演。请在中心补丁浮层审查，批准后才会事务写入本地文件。`,
          timestamp: new Date().toLocaleTimeString(),
          patches: sandboxedPatches,
        };
        emitThreadEvent(patchEvent);
        onPatchReviewRequired?.(patchEvent);
        const result = sandboxFailed
          ? [
              `Patch proposal ${eventId} was created, but sandbox preview failed. Do not claim files were changed.`,
              sandboxedPatches.find((patch) => patch.sandboxOutput)?.sandboxOutput,
              "The workspace was not modified. After the user clicks continue, regenerate a smaller corrected propose_patch using fresh file contents.",
            ].filter(Boolean).join("\n")
          : `Patch proposal ${eventId} created and sandbox preview completed for ${sandboxedPatches.map((patch) => patch.path).join(", ")}. Wait for the user to review and apply it before claiming the files are written.`;
        if (sandboxFailed) {
          const shouldContinue = await waitForExplicitContinue(
            "patchReview",
            { type: "patchReview", payloadId: eventId },
            result,
          );
          if (!shouldContinue) return result;
        }
        return result;
      },
      getWorkspacePath: () => workspaceRoot,
      getSecuritySettings: () => ({ global: securitySettings, project: projectSecurityOverride }),
      getCommandSandboxMode: () => securitySettings?.sandboxMode || providerSettings.sandboxMode || "none",
      getExtensionContext,
      getMaxIterations: () => providerSettings.agent?.maxIterations || 15,
      getAgentSettings: () => providerSettings.agent,
      onContextCompaction: (state: ContextCompactionState) => {
        emitRuntimeEvent({
          id: `context-compaction-${Date.now()}`,
          kind: "contextCompaction",
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "planner",
          title: "Context Compaction",
          status: "done",
          message: [
            `上下文已压缩：约 ${state.sourceTokenEstimate} tokens，触发阈值 ${Math.round(state.triggerRatio * 100)}%。`,
            state.lastSummary ? `摘要：${state.lastSummary.slice(0, 600)}${state.lastSummary.length > 600 ? "..." : ""}` : "",
          ].filter(Boolean).join("\n"),
        });
      },
      onError: (error) => {
        agentLoopErrorRef.current = true;
        setAgentLoopPhase("error");
        dispatchRunSession({ type: "complete", phase: "error" });
        emitRuntimeEvent({
          id: `error-${Date.now()}`,
          kind: "error",
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "verifier",
          title: "Agent Error",
          status: "done",
          message: `Agent loop error: ${error}`,
        });
      },
      onDone: (summary) => {
        setAgentLoopRunning(false);
        setAgentLoopPhase("done");
        dispatchRunSession({ type: "complete", phase: "done" });
        updateTask(task.id, { status: "done" });
        emitRuntimeEvent({
          id: `final-summary-${Date.now()}`,
          kind: "finalSummary",
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "planner",
          title: "Final Summary",
          status: "done",
          message: summary || "Agent 已完成当前任务。",
        });
      },
      onStreamStart: () => {
        setStreamingContent("");
        setStreamingActive(true);
      },
      onStreamChunk: (_streamId, _content, accumulated) => {
        setStreamingContent(accumulated);
      },
      onStreamEnd: (_streamId, finalContent) => {
        setStreamingActive(false);
        if (!finalContent) return;
        const summarized = summarizeAssistantToolOutput(finalContent);
        const safeContent = stripFabricatedToolResults(finalContent);
        const displayContent = looksLikeNonStrictPatchProposal(finalContent)
          ? "Agent 输出了非严格补丁格式，Orbit 已拒绝直接展示或写入，并要求模型改用严格 propose_patch JSON 工具调用。"
          : safeContent || "Agent 输出了疑似工具结果文本，Orbit 已忽略它并会要求模型改用严格 JSON 工具调用。";
        const eventId = latestPhaseEventIdRef.current;
        if (!eventId) return;
        updateThreadEvent(eventId, (event) => event.status === "thinking"
          ? {
              ...event,
              message: summarized || displayContent.substring(0, 500) + (displayContent.length > 500 ? "..." : ""),
            }
          : event);
      },
      shouldCancel: () => agentLoopCancelledRef.current,
    });

    agentLoopEngineRef.current = engine;

    try {
      const providerConfig = providerSettings.configs[providerId] || {};
      const resumeContext = completionContext || recoveredResumeContextRef.current;
      recoveredResumeContextRef.current = undefined;
      await engine.runTask(
        task,
        providerId as LLMProvider,
        model,
        providerConfig.baseUrl || provider.baseUrl,
        runThreadId,
        optionsForReasoningEffort(runControls.selection.reasoningEffort),
        resumeContext,
      );
    } catch (e) {
      agentLoopErrorRef.current = true;
      console.error("Agent loop failed:", e);
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
