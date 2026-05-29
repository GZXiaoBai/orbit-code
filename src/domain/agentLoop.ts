import type { PlanTask } from "./types";
import type { ContextCompactionState } from "./types";

export type ToolParamValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | Array<Record<string, unknown>>
  | Record<string, unknown>;

export type ToolParams = Record<string, ToolParamValue>;

export type AgentLoopPhase =
  | "idle"           // 等待开始
  | "planning"       // 分析任务，制定子步骤
  | "researching"    // 阅读文件，搜索代码，收集上下文
  | "implementing"   // 生成代码修改
  | "reviewing"      // 安全检查与代码审查
  | "waiting_approval" // 等待用户审批
  | "verifying"      // 运行测试验证
  | "healing"        // 自愈修复循环
  | "compacting"     // 压缩上下文
  | "done"           // 任务完成
  | "error"          // 出错
  | "cancelled";     // 用户取消

export interface ToolCall {
  id: string;
  name: ToolName;
  params: ToolParams;
  result?: string;
  error?: string;
  status: "pending" | "running" | "done" | "error";
  startedAt?: string;
  completedAt?: string;
}

export type AgentRuntimeMode = "plan" | "build";

export type ToolName =
  | "read_file"
  | "search_code"
  | "list_files"
  | "run_command"
  | "apply_patch"
  | "propose_patch"
  | "ask_user"
  | "done"
  | "done_plan"
  | "done_build";

export type PlannerResultKind = "message" | "question" | "planDraft" | "done_plan";
export type BuildResultKind = "approval" | "question" | "patchProposal" | "verification" | "done_build";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: Record<string, { type: string; description: string; required: boolean }>;
  execute: (params: ToolParams) => Promise<string>;
  requiresApproval: boolean;
}

export interface LoopContext {
  task: PlanTask;
  phase: AgentLoopPhase;
  iteration: number;
  maxIterations: number;
  toolCalls: ToolCall[];
  messages: LoopMessage[];
  userFeedback?: string;
  startTime: string;
}

export interface LoopMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  timestamp: string;
}

export interface AgentLoopStatus {
  isRunning: boolean;
  phase: AgentLoopPhase;
  currentTask: PlanTask | null;
  currentIteration: number;
  toolCalls: ToolCall[];
  messages: LoopMessage[];
  tokenRecords?: Array<{
    id: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
    timestamp: string;
    streamed: boolean;
  }>;
  totalTokens?: number;
  contextCompaction?: ContextCompactionState;
}
