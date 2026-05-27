import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "../domain/agentEvents";
import type { AgentLoopPhase, ToolCall, ToolParams } from "../domain/agentLoop";
import { AgentLoopEngine, stripFabricatedToolResults } from "./agentLoopEngine";
import { normalizePatchProposal } from "./patchWorkflow";
import type { PatchItem } from "./patchWorkflow";
import type { ImportedPlanState, SessionState } from "./useSession";
import { isTauri } from "../utils/tauri";
import type { LLMProvider } from "../services/llmService";
import { optionsForReasoningEffort } from "../services/llmService";
import type { RunControlsState } from "./useRunControls";
import { findProvider } from "../providers/providerRegistry";
import { createAgentRunSession, reduceAgentRunSession } from "../domain/agentRunSession";
import type { AgentRunSession } from "../domain/agentRunSession";
import type { ContextCompactionState, ProjectSecurityOverride, SecuritySettings } from "../domain/types";
import type { ApprovalRequest } from "./useApprovalQueue";
import type { QuestionRequest } from "../domain/questionRequest";
import { looksLikeNonStrictPatchProposal, parseToolEnvelopes } from "../domain/agentToolEnvelope";

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
  ) => Promise<boolean>;
  requestQuestion: (
    question: string,
    taskId: string,
    scope?: { workspacePath?: string; threadId?: string },
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
  setAgentEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  initialAgentRunSession?: AgentRunSession | null;
}

function toolDisplayName(tool: string): string {
  if (tool === "run_command") return "命令";
  if (tool === "apply_patch") return "补丁";
  if (tool === "ask_user") return "问题";
  if (tool === "read_file") return "读取文件";
  if (tool === "search_code") return "搜索代码";
  if (tool === "list_files") return "列出文件";
  return tool;
}

function compactPhaseMessage(message: string): string {
  const toolMatch = message.match(/(?:Executing|Running):\s*([a-z_]+)/i);
  if (toolMatch) return `正在处理：${toolDisplayName(toolMatch[1])}`;
  const approvalMatch = message.match(/^(run_command|apply_patch|ask_user|read_file|search_code|list_files):/);
  if (approvalMatch) return `等待审查台处理：${toolDisplayName(approvalMatch[1])}`;
  return message;
}

function approvalEventMessage(tool: string, params: ToolParams): string {
  if (tool === "run_command") {
    const command = typeof params.command === "string" ? params.command : "command";
    const args = Array.isArray(params.args) ? params.args.filter((arg): arg is string => typeof arg === "string") : [];
    const reason = typeof params.reason === "string" && params.reason.trim() ? `。原因：${params.reason}` : "";
    return `等待你在审查台批准命令：${[command, ...args].join(" ")}${reason}`;
  }
  if (tool === "apply_patch") return "等待你在审查台审查补丁。批准后才会写入当前工作区。";
  return `等待你在审查台确认：${toolDisplayName(tool)}`;
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
  if (envelope.tool === "apply_patch") {
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
  if (envelope.tool === "done") {
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
  if (!isTauri()) {
    return patches.map((patch) => ({
      ...patch,
      sandboxStatus: "sandboxed",
      sandboxPath: "browser-fixture",
      sandboxOutput: "Browser fixture sandbox preview completed. No workspace files were changed.",
      applyStatus: "proposed",
    }));
  }

  try {
    const preview = await invoke<SandboxPreviewResult>("preview_workspace_patches_in_sandbox", {
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
  setAgentEvents,
  initialAgentRunSession,
}: UseAgentRunArgs) {
  const [agentLoopPhase, setAgentLoopPhase] = useState<AgentLoopPhase>("idle");
  const [agentLoopToolCalls, setAgentLoopToolCalls] = useState<ToolCall[]>([]);
  const [agentLoopRunning, setAgentLoopRunning] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingActive, setStreamingActive] = useState(false);
  const [agentRunSession, dispatchRunSession] = useReducer(reduceAgentRunSession, createAgentRunSession());

  const agentLoopEngineRef = useRef<AgentLoopEngine | null>(null);
  const agentLoopCancelledRef = useRef(false);
  const patchReviewPendingRef = useRef(false);
  const toolCallsRef = useRef(new Map<string, ToolCall>());
  const recoveredRef = useRef(false);
  const continueResolverRef = useRef<((shouldContinue: boolean) => void) | null>(null);
  const recoveredResumeContextRef = useRef<string | undefined>(undefined);
  const agentLoopErrorRef = useRef(false);

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
    setAgentEvents(prev => [...prev, {
      id: `continue-wait-${Date.now()}`,
      role: "reviewer",
      name: "Waiting For Continue",
      status: "idle",
      message: "操作结果已记录。点击“继续执行”后，Agent 才会把这个结果带回模型继续下一步。",
      timestamp: new Date().toLocaleTimeString(),
    }]);
    return new Promise<boolean>((resolve) => {
      continueResolverRef.current = (shouldContinue: boolean) => {
        continueResolverRef.current = null;
        if (shouldContinue) dispatchRunSession({ type: "continue" });
        resolve(shouldContinue);
      };
    });
  }, [setAgentEvents]);

  const startAgentLoop = useCallback(async () => {
    const pushGuardEvent = (message: string) => {
      setAgentEvents(prev => [...prev, {
        id: `guard-${Date.now()}`,
        role: "reviewer",
        name: "Run Guard",
        status: "done",
        message,
        timestamp: new Date().toLocaleTimeString(),
      }]);
    };

    if (runControls.mode !== "build") {
      pushGuardEvent("当前处于 Plan 模式。Agent 只会整理计划，不会执行命令、生成 Patch 或写入文件。切换到 Build 后再启动执行。");
      return;
    }

    const hasResumeContext = Boolean(recoveredResumeContextRef.current);
    const isResumeRun = Boolean(hasResumeContext && agentRunSession.taskId);
    const resumeTaskId = isResumeRun ? agentRunSession.taskId : null;
    const planTasks = importedPlan?.plan.tasks ?? [];
    const selectedTask = selectAgentRunTask({
      tasks: planTasks,
      resumeTaskId,
      currentTaskId: agentRunSession.taskId,
    });
    const task = selectedTask.task;

    const providerId = runControls.selection.providerId;
    const provider = findProvider(providerId);
    const model = runControls.selection.model.trim();

    if (!model) {
      pushGuardEvent("当前没有可用模型。请先在设置中选择服务商、输入 API Key，并导入该 API 返回的模型列表。");
      return;
    }

    if (runControls.missingCredential) {
      pushGuardEvent("已检测到导入过的模型，但凭据库当前未解锁。请到设置 > 模型输入 Orbit 凭据库主密码解锁 API Key 后再启动 Build。");
      return;
    }

    if (!provider || !runControls.buildSupported) {
      if (providerId === "ollama") {
        pushGuardEvent("Ollama 当前仅接入本地模型发现，Agent Build 执行通道尚未接入。请切换到已导入且支持 Build 的模型。");
      } else {
        pushGuardEvent("当前模型没有声明 Build 执行能力。请选择已导入且支持 tool calling / chat completion 的模型后再启动。");
      }
      return;
    }

    if (!provider.capabilities.local && !apiKeys[providerId]) {
      pushGuardEvent(`缺少 ${provider.label} API Key。Build 模式不会生成假 Diff；请先在设置中保存密钥。`);
      return;
    }

    if (!task) {
      pushGuardEvent("没有待执行任务。请先导入或创建 Coding Plan。");
      return;
    }

    setAgentLoopRunning(true);
    agentLoopErrorRef.current = false;
    const runThreadId = isResumeRun
      ? agentRunSession.threadId || threadId
      : threadId;
    const runSessionId = isResumeRun
      ? agentRunSession.id
      : `run-${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingResumeContext = recoveredResumeContextRef.current;
    const finalSummaryOnly = shouldForceFinalSummaryRun({
      completionOnly: selectedTask.completionOnly,
      resumeKind: agentRunSession.resumeKind,
      lastToolResult: agentRunSession.lastToolResult,
      resumeContext: pendingResumeContext,
    });

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

    const engine = new AgentLoopEngine({
      onPhaseChange: (phase, message) => {
        setAgentLoopPhase(phase);
        dispatchRunSession({ type: "phase", phase });
        setAgentEvents(prev => [...prev, {
          id: `loop-${Date.now()}`,
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: phase === "implementing" ? "coder" : phase === "reviewing" ? "reviewer" : phase === "verifying" ? "verifier" : "planner",
          name: `Agent (${phase})`,
          status: phase === "done" || phase === "error" ? "done" : "thinking",
          message: compactPhaseMessage(message),
          timestamp: new Date().toLocaleTimeString(),
        }]);
      },
      onIteration: (iteration, conversationSummary) => {
        dispatchRunSession({ type: "iteration", iteration, conversationSummary });
      },
      onToolCall: (toolCall) => {
        toolCallsRef.current.set(toolCall.id, toolCall);
        dispatchRunSession({ type: "tool", toolCall });
        setAgentLoopToolCalls(prev => [...prev, toolCall]);
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
      },
      onRequestApproval: async (tool, params) => {
        if (["read_file", "list_files", "search_code"].includes(tool)) return true;
        if (finalSummaryOnly) {
          setAgentEvents(prev => [...prev, {
            id: `completion-guard-${Date.now()}`,
            runSessionId,
            workspacePath: workspaceRoot,
            threadId: runThreadId,
            taskId: task.id,
            role: "reviewer",
            name: "Run Guard",
            status: "done",
            message: `当前计划已完成或已验证，这次运行只用于生成最终总结。Orbit 已拒绝新的 ${tool} 请求；请让 Agent 返回 done 总结。`,
            timestamp: new Date().toLocaleTimeString(),
          }]);
          return false;
        }
        const reason = typeof params.reason === "string" ? params.reason : "";
        const approvalParams: ToolParams = {
          ...params,
          taskId: task.id,
          threadId: runThreadId,
          workspacePath: workspaceRoot,
        };
        setAgentEvents(prev => [...prev, {
          id: `approval-${Date.now()}`,
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "reviewer",
          name: "Approval Gate",
          status: "thinking",
          message: approvalEventMessage(tool, approvalParams),
          timestamp: new Date().toLocaleTimeString(),
        }]);
        let approvalId = "";
        const approved = await requestApproval(tool, approvalParams, reason, (request) => {
          approvalId = request.id;
          dispatchRunSession({ type: "approval", approvalId: request.id });
        });
        dispatchRunSession({ type: "approval", approvalId: undefined });
        setAgentEvents(prev => [...prev, {
          id: `approval-result-${Date.now()}`,
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "reviewer",
          name: approved ? "Approval Granted" : "Approval Denied",
          status: "done",
          message: approved
            ? `你已批准 ${tool}。结果已记录，点击“继续执行”后 Agent 才会继续。`
            : `你已拒绝 ${tool}，Agent 将把拒绝结果纳入下一步规划。`,
          timestamp: new Date().toLocaleTimeString(),
        }]);
        const shouldContinue = await waitForExplicitContinue(
          "approval",
          { type: "approval", payloadId: approvalId },
          approved
            ? `Approved ${tool}: ${JSON.stringify(approvalParams)}`
            : `Denied ${tool}: ${JSON.stringify(approvalParams)}`,
        );
        if (!shouldContinue) return false;
        return approved;
      },
      onAskUser: async (question) => {
        if (!patchReviewPendingRef.current && /(patch|diff|补丁|审查台|review|apply)/i.test(question)) {
          return [
            "No patch proposal is currently visible in Orbit Review Dock.",
            "You must call apply_patch with the actual file changes before asking the user to review or apply patches.",
            "Do not install dependencies or run verification until a real patch proposal exists and the user applies it.",
          ].join("\n");
        }
        setAgentEvents(prev => [...prev, {
          id: `question-${Date.now()}`,
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "planner",
          name: "Question",
          status: "thinking",
          message: `Agent 正在等待你的回答：${question}`,
          timestamp: new Date().toLocaleTimeString(),
        }]);
        let questionId = "";
        const answer = await requestQuestion(question, task.id, { workspacePath: workspaceRoot, threadId: runThreadId }, (request) => {
          questionId = request.id;
          dispatchRunSession({ type: "question", questionId: request.id });
        });
        dispatchRunSession({ type: "question", questionId: undefined });
        setAgentEvents(prev => [...prev, {
          id: `question-result-${Date.now()}`,
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "planner",
          name: answer ? "Question Answered" : "Question Cancelled",
          status: "done",
          message: answer
            ? `你已回答 Agent 的问题：${answer}。点击“继续执行”后 Agent 才会继续。`
            : "你取消了 Agent 的问题，Agent 会收到取消结果。",
          timestamp: new Date().toLocaleTimeString(),
        }]);
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
            "Invalid apply_patch for this run: the current plan is already marked done or verified.",
            "This Orbit run is a completion-summary pass only.",
            "Do not generate patches, do not request commands, and do not rerun verification.",
            'Return exactly: {"tool":"done","params":{"summary":"truthful final summary based on the existing successful verification results"}}',
          ].join("\n");
        }
        const patches = normalizePatchProposal(params);
        if (patches.length === 0) return "No valid patches were proposed.";

        const hydratedPatches = await Promise.all(patches.map(async (patch) => {
          if (patch.oldContent || !isTauri()) return patch;
          try {
            const oldContent = await invoke<string>("read_workspace_file", {
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
        setAgentEvents(prev => [...prev, {
          id: eventId,
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "coder",
          name: "Patch Proposal",
          status: "done",
          message: sandboxFailed
            ? `Agent 提出了 ${sandboxedPatches.length} 个文件修改，但沙盒预演失败。当前工作区没有被修改，请在 Review Dock 中查看原因。`
            : `Agent 提出了 ${sandboxedPatches.length} 个文件修改，已在临时沙盒中预演。请在 Review Dock 中审查 Diff，批准后才会事务写入本地文件。`,
          timestamp: new Date().toLocaleTimeString(),
          patches: sandboxedPatches,
        }]);
        const result = sandboxFailed
          ? [
              `Patch proposal ${eventId} was created, but sandbox preview failed. Do not claim files were changed.`,
              sandboxedPatches.find((patch) => patch.sandboxOutput)?.sandboxOutput,
              "The workspace was not modified. After the user clicks continue, regenerate a smaller corrected apply_patch using fresh file contents.",
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
      getMaxIterations: () => providerSettings.agent?.maxIterations || 15,
      getAgentSettings: () => providerSettings.agent,
      onContextCompaction: (state: ContextCompactionState) => {
        setAgentEvents(prev => [...prev, {
          id: `context-compaction-${Date.now()}`,
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "planner",
          name: "Context Compaction",
          status: "done",
          message: [
            `上下文已压缩：约 ${state.sourceTokenEstimate} tokens，触发阈值 ${Math.round(state.triggerRatio * 100)}%。`,
            state.lastSummary ? `摘要：${state.lastSummary.slice(0, 600)}${state.lastSummary.length > 600 ? "..." : ""}` : "",
          ].filter(Boolean).join("\n"),
          timestamp: new Date().toLocaleTimeString(),
        }]);
      },
      onError: (error) => {
        agentLoopErrorRef.current = true;
        setAgentLoopPhase("error");
        dispatchRunSession({ type: "complete", phase: "error" });
        setAgentEvents(prev => [...prev, {
          id: `error-${Date.now()}`,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "verifier",
          name: "Agent Error",
          status: "done",
          message: `Agent loop error: ${error}`,
          timestamp: new Date().toLocaleTimeString(),
        }]);
      },
      onDone: (summary) => {
        setAgentLoopRunning(false);
        setAgentLoopPhase("done");
        dispatchRunSession({ type: "complete", phase: "done" });
        updateTask(task.id, { status: "done" });
        setAgentEvents(prev => [...prev, {
          id: `final-summary-${Date.now()}`,
          runSessionId,
          workspacePath: workspaceRoot,
          threadId: runThreadId,
          taskId: task.id,
          role: "planner",
          name: "Final Summary",
          status: "done",
          message: summary || "Agent 已完成当前任务。",
          timestamp: new Date().toLocaleTimeString(),
        }]);
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
          ? "Agent 输出了非严格补丁格式，Orbit 已拒绝直接展示或写入，并要求模型改用严格 apply_patch JSON 工具调用。"
          : safeContent || "Agent 输出了疑似工具结果文本，Orbit 已忽略它并会要求模型改用严格 JSON 工具调用。";
        setAgentEvents(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0 || prev[lastIdx].status !== "thinking") return prev;
          const next = [...prev];
          next[lastIdx] = {
            ...next[lastIdx],
            message: summarized || displayContent.substring(0, 500) + (displayContent.length > 500 ? "..." : ""),
          };
          return next;
        });
      },
      shouldCancel: () => agentLoopCancelledRef.current,
    });

    agentLoopEngineRef.current = engine;

    try {
      const providerConfig = providerSettings.configs[providerId] || {};
      const completionContext = finalSummaryOnly
        ? [
          recoveredResumeContextRef.current ? `Recovered continuation context:\n${recoveredResumeContextRef.current}` : "",
          "This Orbit run is now a final-summary pass.",
          "The current task already has a successful verification result or all plan tasks are complete.",
          "Do not call apply_patch. Do not call run_command. Do not request npm install. Do not rerun verification.",
          "If a dependency-install command was denied after successful verification, treat it as unnecessary and summarize the already verified result.",
          "Return a strict done tool call with a truthful final summary based only on existing Review Dock, Patch, and Terminal results.",
          'Required output shape: {"tool":"done","params":{"summary":"..."}}',
        ].filter(Boolean).join("\n")
        : undefined;
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
  }, [agentRunSession.id, agentRunSession.taskId, agentRunSession.threadId, apiKeys, importedPlan, projectSecurityOverride, providerSettings.configs, providerSettings.agent, providerSettings.sandboxMode, recordTerminalResult, requestApproval, requestQuestion, runControls, securitySettings, setAgentEvents, threadId, updateTask, waitForExplicitContinue, workspaceRoot]);

  const continueAgentRun = useCallback(() => {
    const resolve = continueResolverRef.current;
    if (resolve) {
      setAgentEvents(prev => [...prev, {
        id: `continue-live-${Date.now()}`,
        role: "planner",
        name: "Continue Agent",
        status: "thinking",
        message: "继续执行：已将用户操作结果交回 Agent。",
        timestamp: new Date().toLocaleTimeString(),
      }]);
      resolve(true);
      return;
    }

    if (!agentRunSession.canContinue && !agentRunSession.resumeKind) return;
    recoveredResumeContextRef.current = agentRunSession.lastToolResult;
    dispatchRunSession({ type: "continue" });
    setAgentEvents(prev => [...prev, {
      id: `continue-recovered-${Date.now()}`,
      role: "planner",
      name: "Continue Agent",
      status: "thinking",
      message: "继续执行恢复的任务。Orbit 会使用上次等待操作的结果和当前任务上下文继续，不会自动跳过审批。",
      timestamp: new Date().toLocaleTimeString(),
    }]);
    void startAgentLoop();
  }, [agentRunSession.canContinue, agentRunSession.resumeKind, setAgentEvents, startAgentLoop]);

  const submitBuildMessage = useCallback((message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return false;
    const activeTask = agentRunSession.taskId
      ? importedPlan?.plan.tasks.find((task) => task.id === agentRunSession.taskId)
      : importedPlan?.plan.tasks.find((task) => task.status !== "done" && task.status !== "verified") || importedPlan?.plan.tasks[0];
    if (!activeTask) {
      setAgentEvents(prev => [...prev, {
        id: `build-message-no-task-${Date.now()}`,
        workspacePath: workspaceRoot,
        threadId,
        role: "planner",
        name: "Build Message",
        status: "done",
        message: "Build 模式收到了补充指令，但当前没有可继续的任务。请先导入计划。",
        timestamp: new Date().toLocaleTimeString(),
      }]);
      return false;
    }

    setAgentEvents(prev => [...prev, {
      id: `user-build-message-${Date.now()}`,
      workspacePath: workspaceRoot,
      threadId,
      taskId: activeTask.id,
      role: "planner",
      name: "User Instruction",
      status: "done",
      message: trimmed,
      timestamp: new Date().toLocaleTimeString(),
    }]);

    recoveredResumeContextRef.current = [
      "User follow-up instruction in Build mode:",
      trimmed,
      "",
      "Continue the current task with this instruction. Do not import this text as a new plan. Do not replace the current Coding Plan.",
      "If the user reports that no Review Dock patch exists, produce a strict apply_patch tool call before claiming a patch was proposed.",
    ].join("\n");

    if (!agentLoopRunning) {
      void startAgentLoop();
    } else {
      setAgentEvents(prev => [...prev, {
        id: `build-message-queued-${Date.now()}`,
        workspacePath: workspaceRoot,
        threadId,
        taskId: activeTask.id,
        role: "planner",
        name: "Instruction Queued",
        status: "idle",
        message: "补充指令已记录。当前 Agent 正在运行；如需要中断，请取消后重新继续。",
        timestamp: new Date().toLocaleTimeString(),
      }]);
    }
    return true;
  }, [agentLoopRunning, agentRunSession.taskId, importedPlan?.plan.tasks, setAgentEvents, startAgentLoop, threadId, workspaceRoot]);

  const markPatchAppliedForContinue = useCallback((eventId: string, details?: string) => {
    dispatchRunSession({
      type: "pauseForContinue",
      resumeKind: "patchReview",
      resumeAction: { type: "patchReview", payloadId: eventId },
      lastToolResult: [
        `Patch proposal ${eventId} was applied transactionally to the workspace.`,
        details,
        "A verification command approval may already be pending in Review Dock.",
        "Do not duplicate the same patch or verification approval; continue from this applied-patch state.",
      ].filter(Boolean).join(" "),
    });
    setAgentEvents(prev => [...prev, {
      id: `continue-patch-${Date.now()}`,
      role: "reviewer",
      name: "Waiting For Continue",
      status: "idle",
      message: "补丁已事务写入。验证命令已进入审查台；点击“继续执行”后，Agent 会把 Patch 已应用的结果纳入下一步。",
      timestamp: new Date().toLocaleTimeString(),
    }]);
  }, [setAgentEvents]);

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
    setAgentEvents(prev => [...prev, {
      id: `continue-verification-${Date.now()}`,
      role: "verifier",
      name: "Waiting For Continue",
      status: "idle",
      message: exitCode === 0
        ? "验证命令已通过。点击“继续执行”后，Agent 会生成最终总结或进入下一步。"
        : "验证命令未通过。点击“继续执行”后，Agent 会读取失败结果并重新规划修复。",
      timestamp: new Date().toLocaleTimeString(),
    }]);
  }, [agentRunSession.taskId, agentRunSession.threadId, agentRunSession.workspacePath, setAgentEvents]);

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
    setAgentEvents(prev => [...prev, {
      id: `continue-recovered-action-${Date.now()}`,
      workspacePath: agentRunSession.workspacePath,
      threadId: agentRunSession.threadId,
      taskId: agentRunSession.taskId || undefined,
      role: "reviewer",
      name: "Waiting For Continue",
      status: "idle",
      message,
      timestamp: new Date().toLocaleTimeString(),
    }]);
  }, [agentRunSession.taskId, agentRunSession.threadId, agentRunSession.workspacePath, setAgentEvents]);

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
