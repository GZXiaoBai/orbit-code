import type { AgentLoopPhase, ToolCall, ToolName, ToolParams } from "../domain/agentLoop";
import type { AgentRunSession, AgentRunSessionAction } from "../domain/agentRunSession";
import type { ThreadEvent } from "../domain/threadEvents";
import type { AgentSettings, ContextCompactionState, PlanTask, ProjectSecurityOverride, SecuritySettings } from "../domain/types";
import { normalizeQuestionOptions, type QuestionOption, type QuestionRequest } from "../domain/questionRequest";
import { looksLikeNonStrictPatchProposal, parseToolEnvelopes } from "../domain/agentToolEnvelope";
import { stripFabricatedToolResults, type AgentLoopCallbacks } from "./agentLoopEngine";
import { normalizePatchProposal, type PatchItem } from "./patchWorkflow";
import { invokeDesktop, isDesktopRuntime } from "../runtime/desktopGateway";
import { summarizeToolParamsForLifecycle, ToolCallExecutor } from "./toolCallExecutor";
import type { ApprovalRequest } from "./useApprovalQueue";
import type { PermissionSchedulerResult } from "../runtime/permissionScheduler";

type RunSessionDispatch = (action: AgentRunSessionAction) => void;

export type RuntimeEventInput = Omit<ThreadEvent, "id" | "timestamp" | "kind" | "role" | "status" | "title" | "message"> & {
  id?: string;
  kind: ThreadEvent["kind"];
  role?: ThreadEvent["role"];
  status?: ThreadEvent["status"];
  title: string;
  message: string;
};

interface SandboxPreviewResult {
  id: string;
  proposal_id: string;
  sandbox_path: string;
  status: "sandboxed" | "failed";
  output: string;
  created_at: string;
}

export function toolDisplayName(tool: string): string {
  if (tool === "run_command") return "命令";
  if (tool === "apply_patch" || tool === "propose_patch") return "补丁";
  if (tool === "ask_user") return "问题";
  if (tool === "read_file") return "读取文件";
  if (tool === "search_code") return "搜索代码";
  if (tool === "list_files") return "列出文件";
  return tool;
}

export function compactPhaseMessage(message: string): string {
  const toolMatch = message.match(/(?:Executing|Running):\s*([a-z_]+)/i);
  if (toolMatch) return `正在处理：${toolDisplayName(toolMatch[1])}`;
  const approvalMatch = message.match(/^(run_command|apply_patch|propose_patch|ask_user|read_file|search_code|list_files):/);
  if (approvalMatch) return `等待中心操作确认：${toolDisplayName(approvalMatch[1])}`;
  return message;
}

export function approvalEventMessage(tool: string, params: ToolParams): string {
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

export async function previewPatchesInSandbox(
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

export interface BuildTurnRuntimeInput {
  task: PlanTask;
  runSessionId: string;
  runThreadId: string;
  workspaceRoot: string;
  finalSummaryOnly: boolean;
  providerSandboxMode?: string;
  securitySettings?: SecuritySettings;
  projectSecurityOverride?: ProjectSecurityOverride;
  toolExecutor: ToolCallExecutor;
  toolCalls: Map<string, ToolCall>;
  patchReviewPending: { current: boolean };
  agentLoopCancelled: { current: boolean };
  latestPhaseEventId: { current: string | null };
  emitRuntimeEvent: (event: RuntimeEventInput) => void;
  emitThreadEvent: (event: ThreadEvent) => void;
  updateThreadEvent: (id: string, update: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent)) => void;
  dispatchRunSession: RunSessionDispatch;
  setAgentLoopPhase: (phase: AgentLoopPhase) => void;
  setAgentLoopRunning: (running: boolean) => void;
  setAgentLoopToolCalls: (updater: (prev: ToolCall[]) => ToolCall[]) => void;
  setStreamingContent: (content: string) => void;
  setStreamingActive: (active: boolean) => void;
  updateTask: (id: string, update: Partial<PlanTask>) => void;
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
  waitForExplicitContinue: (
    resumeKind: NonNullable<AgentRunSession["resumeKind"]>,
    resumeAction: AgentRunSession["resumeAction"],
    lastToolResult: string,
  ) => Promise<boolean>;
  onPatchReviewRequired?: (event: ThreadEvent) => void;
  getExtensionContext?: () => Promise<string> | string;
  getMaxIterations: () => number;
  getAgentSettings: () => AgentSettings | undefined;
  markRuntimeError: () => void;
}

export class BuildTurnRuntime {
  constructor(private readonly input: BuildTurnRuntimeInput) {}

  callbacks(): AgentLoopCallbacks {
    return {
      onPhaseChange: this.onPhaseChange,
      onIteration: (iteration, conversationSummary) => {
        this.input.dispatchRunSession({ type: "iteration", iteration, conversationSummary });
      },
      onToolCall: this.onToolCall,
      onToolResult: this.onToolResult,
      onRequestApproval: this.onRequestApproval,
      onToolDeniedByMode: this.onToolDeniedByMode,
      onAskUser: this.onAskUser,
      onPatchProposed: this.onPatchProposed,
      getWorkspacePath: () => this.input.workspaceRoot,
      getSecuritySettings: () => ({
        global: this.input.securitySettings,
        project: this.input.projectSecurityOverride,
      }),
      getCommandSandboxMode: () => this.input.securitySettings?.sandboxMode || this.input.providerSandboxMode || "none",
      getExtensionContext: this.input.getExtensionContext,
      getMaxIterations: this.input.getMaxIterations,
      getAgentSettings: this.input.getAgentSettings,
      onContextCompaction: this.onContextCompaction,
      onError: this.onError,
      onDone: this.onDone,
      onStreamStart: () => {
        this.input.setStreamingContent("");
        this.input.setStreamingActive(true);
      },
      onStreamChunk: (_streamId, _content, accumulated) => {
        this.input.setStreamingContent(accumulated);
      },
      onStreamEnd: this.onStreamEnd,
      shouldCancel: () => this.input.agentLoopCancelled.current,
    };
  }

  private onPhaseChange: AgentLoopCallbacks["onPhaseChange"] = (phase, message) => {
    const { input } = this;
    input.setAgentLoopPhase(phase);
    input.dispatchRunSession({ type: "phase", phase });
    const eventId = `loop-${Date.now()}`;
    input.latestPhaseEventId.current = eventId;
    input.emitRuntimeEvent({
      id: eventId,
      kind: "reasoningSummary",
      runSessionId: input.runSessionId,
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      taskId: input.task.id,
      role: phase === "implementing" ? "coder" : phase === "reviewing" ? "reviewer" : phase === "verifying" ? "verifier" : "planner",
      title: `Agent (${phase})`,
      status: phase === "done" || phase === "error" ? "done" : "thinking",
      message: compactPhaseMessage(message),
    });
  };

  private onToolCall: AgentLoopCallbacks["onToolCall"] = (toolCall) => {
    const { input } = this;
    input.toolCalls.set(toolCall.id, toolCall);
    input.dispatchRunSession({ type: "tool", toolCall });
    input.setAgentLoopToolCalls((prev) => {
      const next = prev.filter((item) => item.id !== toolCall.id);
      return [...next, toolCall];
    });
    input.toolExecutor.recordGenerated(toolCall, summarizeToolParamsForLifecycle(toolCall.name, toolCall.params));
  };

  private onToolResult: AgentLoopCallbacks["onToolResult"] = (id, result) => {
    const { input } = this;
    const toolCall = input.toolCalls.get(id);
    if (toolCall?.name === "run_command") {
      const command = typeof toolCall.params.command === "string" ? toolCall.params.command : "command";
      const args = Array.isArray(toolCall.params.args) ? toolCall.params.args.filter((arg): arg is string => typeof arg === "string") : [];
      const exitCodeMatch = result.match(/\[exit_code:\s*(-?\d+)\]/);
      const terminalRunId = input.recordTerminalResult({
        workspacePath: input.workspaceRoot,
        threadId: input.runThreadId,
        taskId: input.task.id,
        cwd: typeof toolCall.params.cwd === "string" ? toolCall.params.cwd : undefined,
        command,
        args,
        reason: typeof toolCall.params.reason === "string" ? toolCall.params.reason : "Agent command result",
        output: result,
        exitCode: exitCodeMatch ? Number(exitCodeMatch[1]) : null,
      });
      input.dispatchRunSession({ type: "terminal", terminalRunId });
      input.toolExecutor.recordTerminalResult({
        toolCallId: id,
        terminalRunId,
        result,
        exitCode: exitCodeMatch ? Number(exitCodeMatch[1]) : null,
      });
    } else {
      input.toolExecutor.recordResult(id, result);
    }
    input.setAgentLoopToolCalls((prev) => prev.map((toolCallItem) =>
      toolCallItem.id === id
        ? { ...toolCallItem, result, status: "done", completedAt: new Date().toISOString() }
        : toolCallItem
    ));
  };

  private onRequestApproval: AgentLoopCallbacks["onRequestApproval"] = async (tool, params) => {
    const { input } = this;
    if (["read_file", "list_files", "search_code"].includes(tool)) return true;
    if (input.finalSummaryOnly) {
      input.emitRuntimeEvent({
        id: `completion-guard-${Date.now()}`,
        kind: "toolDeniedByMode",
        runSessionId: input.runSessionId,
        workspacePath: input.workspaceRoot,
        threadId: input.runThreadId,
        taskId: input.task.id,
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
      taskId: input.task.id,
      threadId: input.runThreadId,
      workspacePath: input.workspaceRoot,
    };
    input.emitRuntimeEvent({
      id: `approval-${Date.now()}`,
      kind: "approval",
      runSessionId: input.runSessionId,
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      taskId: input.task.id,
      role: "reviewer",
      title: "Approval Gate",
      status: "thinking",
      message: approvalEventMessage(tool, approvalParams),
    });
    let approvalId = "";
    const toolCallId = typeof approvalParams.toolCallId === "string"
      ? approvalParams.toolCallId
      : `approval-${Date.now()}`;
    const approvalResult = await input.toolExecutor.requestApproval({
      toolCall: {
        id: toolCallId,
        name: tool as ToolName,
        params: approvalParams,
        status: "pending",
      },
      params: approvalParams,
      reason,
      requestApproval: input.requestApproval,
      onCreated: (request) => {
        approvalId = request.id;
        input.dispatchRunSession({ type: "approval", approvalId: request.id });
      },
    });
    const approval = approvalResult.approval;
    input.dispatchRunSession({ type: "approval", approvalId: undefined });
    input.emitRuntimeEvent({
      id: `approval-result-${Date.now()}`,
      kind: "approval",
      runSessionId: input.runSessionId,
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      taskId: input.task.id,
      role: "reviewer",
      title: approval.approved ? "Approval Granted" : "Approval Denied",
      status: "done",
      message: approval.approved
        ? `你已批准 ${tool}。结果已记录，点击“继续执行”后 Agent 才会继续。`
        : `你已拒绝 ${tool}，Agent 将把拒绝结果纳入下一步规划。`,
    });
    const shouldContinue = await input.waitForExplicitContinue(
      "approval",
      { type: "approval", payloadId: approvalId },
      approval.toolResult,
    );
    if (!shouldContinue) return { ...approval, approved: false, toolResult: "Cancelled by user before resuming the agent." };
    return approval;
  };

  private onToolDeniedByMode: AgentLoopCallbacks["onToolDeniedByMode"] = (tool, mode) => {
    const { input } = this;
    input.emitRuntimeEvent({
      id: `mode-denied-${Date.now()}`,
      kind: "toolDeniedByMode",
      runSessionId: input.runSessionId,
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      taskId: input.task.id,
      role: "reviewer",
      title: "Tool Denied By Mode",
      status: "done",
      message: `${mode === "plan" ? "Plan" : "Build"} 模式拒绝了工具 ${tool}。当前模式只能使用已注册的工具。`,
    });
  };

  private onAskUser: NonNullable<AgentLoopCallbacks["onAskUser"]> = async (question, params) => {
    const { input } = this;
    if (!input.patchReviewPending.current && /(patch|diff|补丁|审查台|review|apply)/i.test(question)) {
      return [
        "No patch proposal is currently available in Orbit.",
        "You must call propose_patch with the actual file changes before asking the user to review or apply patches.",
        "Do not install dependencies or run verification until a real patch proposal exists and the user applies it.",
      ].join("\n");
    }
    const options = normalizeQuestionOptions(params.options);
    const allowFreeform = params.allowFreeform === true;
    let questionId = "";
    const answer = await input.requestQuestion(question, input.task.id, {
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      source: "agent",
      kind: options.length > 0 ? "singleChoice" : "text",
      options,
      allowFreeform,
    }, (request) => {
      questionId = request.id;
      input.emitRuntimeEvent({
        id: `question-${Date.now()}`,
        kind: "question",
        runSessionId: input.runSessionId,
        workspacePath: input.workspaceRoot,
        threadId: input.runThreadId,
        taskId: input.task.id,
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
      input.dispatchRunSession({ type: "question", questionId: request.id });
    });
    input.dispatchRunSession({ type: "question", questionId: undefined });
    input.emitRuntimeEvent({
      id: `question-result-${Date.now()}`,
      kind: "question",
      runSessionId: input.runSessionId,
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      taskId: input.task.id,
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
    const shouldContinue = await input.waitForExplicitContinue(
      "question",
      { type: "question", payloadId: questionId },
      answer ? `User answered: ${answer}` : "User cancelled question.",
    );
    if (!shouldContinue) return null;
    return answer;
  };

  private onPatchProposed: NonNullable<AgentLoopCallbacks["onPatchProposed"]> = async (params) => {
    const { input } = this;
    if (input.finalSummaryOnly) {
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
          workspacePath: input.workspaceRoot,
        });
        return { ...patch, oldContent };
      } catch {
        return patch;
      }
    }));

    const eventId = `patch-${Date.now()}`;
    const sandboxedPatches = await previewPatchesInSandbox(eventId, hydratedPatches, input.workspaceRoot);
    const sandboxFailed = sandboxedPatches.some((patch) => patch.sandboxStatus === "failed");
    input.patchReviewPending.current = true;
    input.dispatchRunSession({ type: "patch", patchProposalId: eventId });
    const patchEvent: ThreadEvent = {
      id: eventId,
      kind: "patchProposal",
      runSessionId: input.runSessionId,
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      taskId: input.task.id,
      role: "coder",
      title: "Patch Proposal",
      status: "done",
      message: sandboxFailed
        ? `Agent 提出了 ${sandboxedPatches.length} 个文件修改，但沙盒预演失败。当前工作区没有被修改，请在详情中查看原因。`
        : `Agent 提出了 ${sandboxedPatches.length} 个文件修改，已在临时沙盒中预演。请在中心补丁浮层审查，批准后才会事务写入本地文件。`,
      timestamp: new Date().toLocaleTimeString(),
      patches: sandboxedPatches,
    };
    input.emitThreadEvent(patchEvent);
    input.onPatchReviewRequired?.(patchEvent);
    const result = sandboxFailed
      ? [
          `Patch proposal ${eventId} was created, but sandbox preview failed. Do not claim files were changed.`,
          sandboxedPatches.find((patch) => patch.sandboxOutput)?.sandboxOutput,
          "The workspace was not modified. After the user clicks continue, regenerate a smaller corrected propose_patch using fresh file contents.",
        ].filter(Boolean).join("\n")
      : `Patch proposal ${eventId} created and sandbox preview completed for ${sandboxedPatches.map((patch) => patch.path).join(", ")}. Wait for the user to review and apply it before claiming the files are written.`;
    if (sandboxFailed) {
      const shouldContinue = await input.waitForExplicitContinue(
        "patchReview",
        { type: "patchReview", payloadId: eventId },
        result,
      );
      if (!shouldContinue) return result;
    }
    return result;
  };

  private onContextCompaction: NonNullable<AgentLoopCallbacks["onContextCompaction"]> = (state: ContextCompactionState) => {
    const { input } = this;
    input.emitRuntimeEvent({
      id: `context-compaction-${Date.now()}`,
      kind: "contextCompaction",
      runSessionId: input.runSessionId,
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      taskId: input.task.id,
      role: "planner",
      title: "Context Compaction",
      status: "done",
      message: [
        `上下文已压缩：约 ${state.sourceTokenEstimate} tokens，触发阈值 ${Math.round(state.triggerRatio * 100)}%。`,
        state.lastSummary ? `摘要：${state.lastSummary.slice(0, 600)}${state.lastSummary.length > 600 ? "..." : ""}` : "",
      ].filter(Boolean).join("\n"),
    });
  };

  private onError: AgentLoopCallbacks["onError"] = (error) => {
    const { input } = this;
    input.markRuntimeError();
    input.setAgentLoopPhase("error");
    input.dispatchRunSession({ type: "complete", phase: "error" });
    input.emitRuntimeEvent({
      id: `error-${Date.now()}`,
      kind: "error",
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      taskId: input.task.id,
      role: "verifier",
      title: "Agent Error",
      status: "done",
      message: `Agent loop error: ${error}`,
    });
  };

  private onDone: AgentLoopCallbacks["onDone"] = (summary) => {
    const { input } = this;
    input.setAgentLoopRunning(false);
    input.setAgentLoopPhase("done");
    input.dispatchRunSession({ type: "complete", phase: "done" });
    input.updateTask(input.task.id, { status: "done" });
    input.emitRuntimeEvent({
      id: `final-summary-${Date.now()}`,
      kind: "finalSummary",
      runSessionId: input.runSessionId,
      workspacePath: input.workspaceRoot,
      threadId: input.runThreadId,
      taskId: input.task.id,
      role: "planner",
      title: "Final Summary",
      status: "done",
      message: summary || "Agent 已完成当前任务。",
    });
  };

  private onStreamEnd: NonNullable<AgentLoopCallbacks["onStreamEnd"]> = (_streamId, finalContent) => {
    const { input } = this;
    input.setStreamingActive(false);
    if (!finalContent) return;
    const summarized = summarizeAssistantToolOutput(finalContent);
    const safeContent = stripFabricatedToolResults(finalContent);
    const displayContent = looksLikeNonStrictPatchProposal(finalContent)
      ? "Agent 输出了非严格补丁格式，Orbit 已拒绝直接展示或写入，并要求模型改用严格 propose_patch JSON 工具调用。"
      : safeContent || "Agent 输出了疑似工具结果文本，Orbit 已忽略它并会要求模型改用严格 JSON 工具调用。";
    const eventId = input.latestPhaseEventId.current;
    if (!eventId) return;
    input.updateThreadEvent(eventId, (event) => event.status === "thinking"
      ? {
          ...event,
          message: summarized || displayContent.substring(0, 500) + (displayContent.length > 500 ? "..." : ""),
        }
      : event);
  };
}
