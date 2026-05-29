import type { PatchApplyStatus, PatchSandboxStatus } from "./types";
import type { CodingPlan } from "./types";

export interface AgentEventPatch {
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

export interface AgentEventQuestionOption {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface AgentEventQuestion {
  requestId?: string;
  question: string;
  status: "pending" | "answered" | "cancelled";
  answer?: string;
  selectedOptionId?: string;
  options?: AgentEventQuestionOption[];
}

export interface AgentEvent {
  id: string;
  workspacePath?: string;
  threadId?: string;
  taskId?: string;
  runSessionId?: string;
  role: "planner" | "coder" | "reviewer" | "verifier";
  name: string;
  status: "thinking" | "active" | "idle" | "done";
  message: string;
  timestamp: string;
  createdAt?: string;
  patches?: AgentEventPatch[];
  question?: AgentEventQuestion;
  planDraft?: CodingPlan;
}
