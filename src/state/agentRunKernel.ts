import type { AgentRunSession } from "../domain/agentRunSession";
import type { PlanTask } from "../domain/types";
import type { LLMProvider } from "../services/llmService";
import { findProvider } from "../providers/providerRegistry";
import type { RunControlsState } from "./useRunControls";
import type { ImportedPlanState, SessionState } from "./useSession";

export interface AgentRunTaskSelection {
  task: ImportedPlanState["plan"]["tasks"][number] | undefined;
  completionOnly: boolean;
}

export interface PreparedBuildTurn {
  task: PlanTask;
  provider: NonNullable<ReturnType<typeof findProvider>>;
  providerId: LLMProvider;
  model: string;
  runThreadId: string;
  runSessionId: string;
  isResumeRun: boolean;
  pendingResumeContext?: string;
  finalSummaryOnly: boolean;
  completionContext?: string;
}

export interface BuildTurnGuard {
  message: string;
}

export type BuildTurnPreparation =
  | { ok: true; value: PreparedBuildTurn }
  | { ok: false; guard: BuildTurnGuard };

export function selectAgentRunTask(input: {
  tasks: ImportedPlanState["plan"]["tasks"];
  resumeTaskId?: string | null;
  currentTaskId?: string | null;
}): AgentRunTaskSelection {
  const pendingTask = input.tasks.find((task) => task.status !== "done" && task.status !== "verified");
  if (input.resumeTaskId) {
    const task = input.tasks.find((item) => item.id === input.resumeTaskId);
    return { task, completionOnly: Boolean(task && !pendingTask) };
  }
  if (pendingTask) return { task: pendingTask, completionOnly: false };
  const currentTask = input.currentTaskId
    ? input.tasks.find((task) => task.id === input.currentTaskId)
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

export function buildFinalSummaryResumeContext(input: {
  recoveredResumeContext?: string;
}): string {
  return [
    input.recoveredResumeContext ? `Recovered continuation context:\n${input.recoveredResumeContext}` : "",
    "This Orbit run is now a final-summary pass.",
    "The current task already has a successful verification result or all plan tasks are complete.",
    "Do not call propose_patch. Do not call run_command. Do not request npm install. Do not rerun verification.",
    "If a dependency-install command was denied after successful verification, treat it as unnecessary and summarize the already verified result.",
    "Return a strict done_build tool call with a truthful final summary based only on existing patch and terminal results.",
    'Required output shape: {"tool":"done_build","params":{"summary":"..."}}',
  ].filter(Boolean).join("\n");
}

export class AgentRunKernel {
  prepareBuildTurn(input: {
    importedPlan: ImportedPlanState | null;
    providerSettings: SessionState["providerSettings"];
    apiKeys: SessionState["apiKeys"];
    runControls: RunControlsState;
    agentRunSession: AgentRunSession;
    workspaceRoot: string;
    threadId: string;
    recoveredResumeContext?: string;
  }): BuildTurnPreparation {
    if (input.runControls.mode !== "build") {
      return { ok: false, guard: { message: "当前处于 Plan 模式。Agent 只会整理计划，不会执行命令、生成 Patch 或写入文件。切换到 Build 后再启动执行。" } };
    }

    const hasResumeContext = Boolean(input.recoveredResumeContext);
    const isResumeRun = Boolean(hasResumeContext && input.agentRunSession.taskId);
    const resumeTaskId = isResumeRun ? input.agentRunSession.taskId : null;
    const planTasks = input.importedPlan?.plan.tasks ?? [];
    const selectedTask = selectAgentRunTask({
      tasks: planTasks,
      resumeTaskId,
      currentTaskId: input.agentRunSession.taskId,
    });
    const task = selectedTask.task;

    const providerId = input.runControls.selection.providerId;
    const provider = findProvider(providerId);
    const model = input.runControls.selection.model.trim();

    if (!model) {
      return { ok: false, guard: { message: "当前没有可用模型。请先在设置中选择服务商、输入 API Key，并导入该 API 返回的模型列表。" } };
    }

    if (input.runControls.missingCredential) {
      return { ok: false, guard: { message: "已检测到导入过的模型，但凭据库当前未解锁。请到设置 > 模型输入 Orbit 凭据库主密码解锁 API Key 后再启动 Build。" } };
    }

    if (!provider || !input.runControls.buildSupported) {
      if (providerId === "ollama") {
        return { ok: false, guard: { message: "Ollama 当前仅接入本地模型发现，Agent Build 执行通道尚未接入。请切换到已导入且支持 Build 的模型。" } };
      }
      return { ok: false, guard: { message: "当前模型没有声明 Build 执行能力。请选择已导入且支持 tool calling / chat completion 的模型后再启动。" } };
    }

    if (!provider.capabilities.local && !input.apiKeys[providerId]) {
      return { ok: false, guard: { message: `缺少 ${provider.label} API Key。Build 模式不会生成假 Diff；请先在设置中保存密钥。` } };
    }

    if (!task) {
      return { ok: false, guard: { message: "没有待执行任务。请先导入或创建 Coding Plan。" } };
    }

    const runThreadId = isResumeRun
      ? input.agentRunSession.threadId || input.threadId
      : input.threadId;
    const runSessionId = isResumeRun
      ? input.agentRunSession.id
      : `run-${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
    const finalSummaryOnly = shouldForceFinalSummaryRun({
      completionOnly: selectedTask.completionOnly,
      resumeKind: input.agentRunSession.resumeKind,
      lastToolResult: input.agentRunSession.lastToolResult,
      resumeContext: input.recoveredResumeContext,
    });

    return {
      ok: true,
      value: {
        task,
        provider,
        providerId: providerId as LLMProvider,
        model,
        runThreadId,
        runSessionId,
        isResumeRun,
        pendingResumeContext: input.recoveredResumeContext,
        finalSummaryOnly,
        completionContext: finalSummaryOnly
          ? buildFinalSummaryResumeContext({ recoveredResumeContext: input.recoveredResumeContext })
          : undefined,
      },
    };
  }
}
