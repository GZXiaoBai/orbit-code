import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "../domain/agentEvents";
import type { AgentLoopPhase, ToolCall, ToolParams } from "../domain/agentLoop";
import { AgentLoopEngine } from "./agentLoopEngine";
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
import type { ProjectSecurityOverride, SecuritySettings } from "../domain/types";
import type { ApprovalRequest } from "./useApprovalQueue";
import type { QuestionRequest } from "../domain/questionRequest";

interface UseAgentRunArgs {
  importedPlan: ImportedPlanState | null;
  updateTask: SessionState["updateTask"];
  providerSettings: SessionState["providerSettings"];
  apiKeys: SessionState["apiKeys"];
  runControls: RunControlsState;
  workspaceRoot: string;
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
    onCreated?: (request: QuestionRequest) => void
  ) => Promise<string | null>;
  cancelPendingApprovals: () => void;
  cancelPendingQuestions: () => void;
  recordTerminalResult: (input: {
    taskId: string;
    command: string;
    args?: string[];
    reason?: string;
    output: string;
    exitCode?: number | null;
  }) => string;
  setAgentEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  initialAgentRunSession?: AgentRunSession | null;
}

const SUPPORTED_BUILD_PROVIDERS: LLMProvider[] = ["openai", "anthropic", "google", "deepseek", "fixture"];

function isBuildProvider(providerId: string): providerId is LLMProvider {
  return SUPPORTED_BUILD_PROVIDERS.includes(providerId as LLMProvider);
}

interface SandboxPreviewResult {
  id: string;
  proposal_id: string;
  sandbox_path: string;
  status: "sandboxed" | "failed";
  output: string;
  created_at: string;
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
  const toolCallsRef = useRef(new Map<string, ToolCall>());
  const recoveredRef = useRef(false);

  useEffect(() => {
    if (!initialAgentRunSession || recoveredRef.current) return;
    recoveredRef.current = true;
    dispatchRunSession({ type: "recover", session: initialAgentRunSession });
    setAgentLoopPhase(initialAgentRunSession.phase);
  }, [initialAgentRunSession]);

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

    const task = importedPlan?.plan.tasks.find(t => t.status !== "done" && t.status !== "verified");
    if (!task) {
      pushGuardEvent("没有待执行任务。请先导入或创建 Coding Plan。");
      return;
    }

    const providerId = runControls.selection.providerId;
    const provider = findProvider(providerId);
    const model = runControls.selection.model.trim();

    if (!provider || !isBuildProvider(providerId)) {
      if (providerId === "ollama") {
        pushGuardEvent("Ollama 当前仅接入本地模型发现，Agent Build 执行通道尚未接入。请切换到已导入的 OpenAI、Anthropic、Gemini、DeepSeek 或 Fixture 模型。");
      } else {
        pushGuardEvent("当前服务商还没有接入 Build 执行通道。请选择 OpenAI、Anthropic、Gemini、DeepSeek 或 Fixture 后再启动。");
      }
      return;
    }

    if (!model) {
      pushGuardEvent("当前没有可用模型。请先在设置中选择服务商、输入 API Key，并导入该 API 返回的模型列表。");
      return;
    }

    if (!provider.capabilities.local && !apiKeys[providerId]) {
      pushGuardEvent(`缺少 ${provider.label} API Key。Build 模式不会生成假 Diff；请先在设置中保存密钥。`);
      return;
    }

    setAgentLoopRunning(true);
    dispatchRunSession({ type: "start", taskId: task.id });
    agentLoopCancelledRef.current = false;
    setAgentLoopPhase("planning");
    setAgentLoopToolCalls([]);
    toolCallsRef.current.clear();

    const threadId = `thread-${Date.now()}`;
    if (isTauri()) {
      try {
        await invoke("create_thread", {
          id: threadId,
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
          role: phase === "implementing" ? "coder" : phase === "reviewing" ? "reviewer" : phase === "verifying" ? "verifier" : "planner",
          name: `Agent (${phase})`,
          status: phase === "done" || phase === "error" ? "done" : "thinking",
          message,
          timestamp: new Date().toLocaleTimeString(),
        }]);
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
            taskId: task.id,
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
        const reason = typeof params.reason === "string" ? params.reason : "";
        const approvalParams: ToolParams = {
          ...params,
          taskId: task.id,
          workspacePath: workspaceRoot,
        };
        setAgentEvents(prev => [...prev, {
          id: `approval-${Date.now()}`,
          role: "reviewer",
          name: "Approval Gate",
          status: "thinking",
          message: `Requesting approval: ${tool} — ${JSON.stringify(approvalParams).substring(0, 100)}`,
          timestamp: new Date().toLocaleTimeString(),
        }]);
        const approved = await requestApproval(tool, approvalParams, reason, (request) => {
          dispatchRunSession({ type: "approval", approvalId: request.id });
        });
        dispatchRunSession({ type: "approval", approvalId: undefined });
        setAgentEvents(prev => [...prev, {
          id: `approval-result-${Date.now()}`,
          role: "reviewer",
          name: approved ? "Approval Granted" : "Approval Denied",
          status: "done",
          message: approved
            ? `你已批准 ${tool}，Agent 将继续执行。`
            : `你已拒绝 ${tool}，Agent 将把拒绝结果纳入下一步规划。`,
          timestamp: new Date().toLocaleTimeString(),
        }]);
        return approved;
      },
      onAskUser: async (question) => {
        setAgentEvents(prev => [...prev, {
          id: `question-${Date.now()}`,
          role: "planner",
          name: "Question",
          status: "thinking",
          message: `Agent 正在等待你的回答：${question}`,
          timestamp: new Date().toLocaleTimeString(),
        }]);
        const answer = await requestQuestion(question, task.id, (request) => {
          dispatchRunSession({ type: "question", questionId: request.id });
        });
        dispatchRunSession({ type: "question", questionId: undefined });
        setAgentEvents(prev => [...prev, {
          id: `question-result-${Date.now()}`,
          role: "planner",
          name: answer ? "Question Answered" : "Question Cancelled",
          status: "done",
          message: answer
            ? `你已回答 Agent 的问题：${answer}`
            : "你取消了 Agent 的问题，Agent 会收到取消结果。",
          timestamp: new Date().toLocaleTimeString(),
        }]);
        return answer;
      },
      onPatchProposed: async (params) => {
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
        dispatchRunSession({ type: "patch", patchProposalId: eventId });
        setAgentEvents(prev => [...prev, {
          id: eventId,
          role: "coder",
          name: "Patch Proposal",
          status: "done",
          message: sandboxFailed
            ? `Agent 提出了 ${sandboxedPatches.length} 个文件修改，但沙盒预演失败。当前工作区没有被修改，请在 Review Dock 中查看原因。`
            : `Agent 提出了 ${sandboxedPatches.length} 个文件修改，已在临时沙盒中预演。请在 Review Dock 中审查 Diff，批准后才会事务写入本地文件。`,
          timestamp: new Date().toLocaleTimeString(),
          patches: sandboxedPatches,
        }]);
        return sandboxFailed
          ? `Patch proposal ${eventId} was created, but sandbox preview failed. Do not claim files were changed. Wait for the user to review the failure.`
          : `Patch proposal ${eventId} created and sandbox preview completed for ${sandboxedPatches.map((patch) => patch.path).join(", ")}. Wait for the user to review and apply it before claiming the files are written.`;
      },
      getWorkspacePath: () => workspaceRoot,
      getSecuritySettings: () => ({ global: securitySettings, project: projectSecurityOverride }),
      getMaxIterations: () => providerSettings.agent?.maxIterations || 15,
      getAgentSettings: () => providerSettings.agent,
      onError: (error) => {
        setAgentEvents(prev => [...prev, {
          id: `error-${Date.now()}`,
          role: "verifier",
          name: "Agent Error",
          status: "done",
          message: `Agent loop error: ${error}`,
          timestamp: new Date().toLocaleTimeString(),
        }]);
      },
      onDone: () => {
        setAgentLoopRunning(false);
        setAgentLoopPhase("done");
        dispatchRunSession({ type: "complete", phase: "done" });
        updateTask(task.id, { status: "done" });
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
        setAgentEvents(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0 || prev[lastIdx].status !== "thinking") return prev;
          const next = [...prev];
          next[lastIdx] = {
            ...next[lastIdx],
            message: finalContent.substring(0, 500) + (finalContent.length > 500 ? "..." : ""),
          };
          return next;
        });
      },
      shouldCancel: () => agentLoopCancelledRef.current,
    });

    agentLoopEngineRef.current = engine;

    try {
      const providerConfig = providerSettings.configs[providerId] || {};
      await engine.runTask(
        task,
        providerId,
        model,
        providerConfig.baseUrl || provider.baseUrl,
        threadId,
        optionsForReasoningEffort(runControls.selection.reasoningEffort)
      );
    } catch (e) {
      console.error("Agent loop failed:", e);
    }

    setAgentLoopRunning(false);
    setAgentLoopPhase("idle");
    if (!agentLoopCancelledRef.current) {
      dispatchRunSession({ type: "complete", phase: "idle" });
    }
  }, [apiKeys, importedPlan, projectSecurityOverride, providerSettings.configs, providerSettings.agent?.maxIterations, recordTerminalResult, requestApproval, requestQuestion, runControls, securitySettings, setAgentEvents, updateTask, workspaceRoot]);

  const cancelAgentLoop = useCallback(() => {
    agentLoopCancelledRef.current = true;
    setAgentLoopRunning(false);
    setAgentLoopPhase("cancelled");
    dispatchRunSession({ type: "complete", phase: "cancelled" });
    setStreamingActive(false);
    setStreamingContent("");
    cancelPendingApprovals();
    cancelPendingQuestions();
    agentLoopEngineRef.current?.cancel();
  }, [cancelPendingApprovals, cancelPendingQuestions]);

  return {
    agentLoopPhase,
    agentLoopToolCalls,
    agentLoopRunning,
    startAgentLoop,
    cancelAgentLoop,
    streamingContent,
    streamingActive,
    agentRunSession,
  };
}
