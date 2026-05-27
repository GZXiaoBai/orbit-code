import type { PatchApplyStatus, PatchSandboxStatus } from "./types";

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
}
