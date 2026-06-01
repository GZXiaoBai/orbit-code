import type { ToolParams } from "./runtimePrimitives";
import type { TerminalRun } from "./terminalRun";
import type { CodingPlan, PatchApplyStatus, PatchSandboxStatus } from "./types";

export type ThreadEventKind =
  | "userMessage"
  | "agentMessage"
  | "reasoningSummary"
  | "plan"
  | "planDraft"
  | "toolCall"
  | "approval"
  | "patchProposal"
  | "question"
  | "verification"
  | "terminalRun"
  | "contextCompaction"
  | "error"
  | "agentSummary"
  | "commandBegin"
  | "commandEnd"
  | "commandExecution"
  | "approvalRequest"
  | "approvalResult"
  | "finalSummary"
  | "modeSwitch"
  | "toolDeniedByMode"
  | "checkpoint"
  | "rollback"
  | "todoList"
  | "taskProgress";

export type ThreadEventRole = "planner" | "coder" | "reviewer" | "verifier";
export type ThreadEventStatus = "thinking" | "active" | "idle" | "done";
export type RuntimeItemStatus = "started" | "updated" | "completed" | "failed";

export interface ThreadPatch {
  path: string;
  oldContent: string;
  newContent: string;
  applied: boolean;
  sandboxStatus?: PatchSandboxStatus;
  sandboxPath?: string;
  sandboxOutput?: string;
  applyStatus?: PatchApplyStatus;
  hasConflict?: boolean;
  conflictContent?: string;
  resolvedContent?: string;
  conflictResolved?: boolean;
}

export interface ThreadQuestionOption {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface ThreadQuestion {
  requestId?: string;
  question: string;
  status: "pending" | "answered" | "cancelled";
  answer?: string;
  selectedOptionId?: string;
  options?: ThreadQuestionOption[];
}

export interface ThreadToolCallPayload {
  id: string;
  name: string;
  params?: ToolParams;
  status: "pending" | "running" | "done" | "error" | "denied";
  result?: string;
  error?: string;
}

export interface ThreadApprovalPayload {
  requestId?: string;
  tool: string;
  params?: ToolParams;
  status: "pending" | "approved" | "denied" | "cancelled";
  grantScope?: "once" | "session" | "project";
  resolvedAt?: string;
  reason?: string;
}

export interface ThreadVerificationPayload {
  approvalId?: string;
  terminalRunId?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  status: "pending" | "approved" | "denied" | "running" | "passed" | "failed" | "cancelled";
  exitCode?: number | null;
  reason?: string;
}

export interface ThreadCheckpointPayload {
  checkpointId: string;
  strategy: "git-shadow" | "file-snapshot";
  filePaths: string[];
  status: "created" | "failed";
  error?: string;
}

export interface ThreadRollbackPayload {
  checkpointId: string;
  filePaths: string[];
  status: "pending" | "running" | "restored" | "failed";
  actor: "user" | "agent" | "system";
  error?: string;
}

export interface ThreadModeSwitchPayload {
  from: "plan" | "build";
  to: "plan" | "build";
  reason?: string;
}

export interface ThreadToolDeniedPayload {
  tool: string;
  mode: "plan" | "build";
  reason: string;
}

export type TodoItemStatus = "pending" | "inProgress" | "completed" | "failed" | "blocked";

export interface ThreadTodoItem {
  id: string;
  title: string;
  status: TodoItemStatus;
  evidenceEventIds: string[];
}

export interface ThreadTodoListPayload {
  source: "plan" | "build" | "replan";
  items: ThreadTodoItem[];
}

export interface ThreadTaskProgressPayload {
  taskId: string;
  status: TodoItemStatus;
  evidenceEventIds: string[];
  reason?: string;
}

export interface ThreadEventProtocol {
  id: string;
  kind: ThreadEventKind;
  workspacePath?: string;
  threadId?: string;
  taskId?: string;
  runSessionId?: string;
  role: ThreadEventRole;
  status: ThreadEventStatus;
  runtimeStatus?: RuntimeItemStatus;
  title: string;
  message: string;
  timestamp: string;
  createdAt?: string;
  patches?: ThreadPatch[];
  question?: ThreadQuestion;
  planDraft?: CodingPlan;
  toolCall?: ThreadToolCallPayload;
  toolResult?: ThreadToolCallPayload;
  approval?: ThreadApprovalPayload;
  verification?: ThreadVerificationPayload;
  terminalRun?: TerminalRun;
  checkpoint?: ThreadCheckpointPayload;
  rollback?: ThreadRollbackPayload;
  todoList?: ThreadTodoListPayload;
  taskProgress?: ThreadTaskProgressPayload;
  modeSwitch?: ThreadModeSwitchPayload;
  toolDeniedByMode?: ThreadToolDeniedPayload;
  contextCompaction?: {
    sourceTokenEstimate?: number;
    triggerRatio?: number;
    summary?: string;
  };
}
