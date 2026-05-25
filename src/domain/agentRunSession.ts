import type { AgentLoopPhase, ToolCall } from "./agentLoop";

export interface AgentRunSession {
  taskId: string | null;
  phase: AgentLoopPhase;
  currentToolCall?: ToolCall;
  pendingApprovalId?: string;
  pendingQuestionId?: string;
  resumeKind?: "approval" | "question" | "patchReview" | "verification";
  patchProposalIds: string[];
  terminalRunIds: string[];
  updatedAt: string;
}

export type AgentRunSessionAction =
  | { type: "start"; taskId: string; at?: string }
  | { type: "phase"; phase: AgentLoopPhase; at?: string }
  | { type: "tool"; toolCall?: ToolCall; at?: string }
  | { type: "approval"; approvalId?: string; at?: string }
  | { type: "question"; questionId?: string; at?: string }
  | { type: "patch"; patchProposalId: string; at?: string }
  | { type: "terminal"; terminalRunId: string; at?: string }
  | { type: "complete"; phase?: AgentLoopPhase; at?: string }
  | { type: "recover"; session: AgentRunSession };

export function createAgentRunSession(at = new Date().toISOString()): AgentRunSession {
  return {
    taskId: null,
    phase: "idle",
    patchProposalIds: [],
    terminalRunIds: [],
    updatedAt: at,
  };
}

export function reduceAgentRunSession(
  session: AgentRunSession,
  action: AgentRunSessionAction,
): AgentRunSession {
  if (action.type === "recover") return action.session;
  const updatedAt = action.at || new Date().toISOString();

  switch (action.type) {
    case "start":
      return {
        taskId: action.taskId,
        phase: "planning",
        patchProposalIds: [],
        terminalRunIds: [],
        updatedAt,
      };
    case "phase":
      return { ...session, phase: action.phase, updatedAt };
    case "tool":
      return { ...session, currentToolCall: action.toolCall, updatedAt };
    case "approval":
      return {
        ...session,
        pendingApprovalId: action.approvalId,
        resumeKind: action.approvalId ? "approval" : undefined,
        updatedAt,
      };
    case "question":
      return {
        ...session,
        pendingQuestionId: action.questionId,
        resumeKind: action.questionId ? "question" : undefined,
        updatedAt,
      };
    case "patch":
      return {
        ...session,
        patchProposalIds: [...session.patchProposalIds, action.patchProposalId],
        phase: "reviewing",
        resumeKind: "patchReview",
        updatedAt,
      };
    case "terminal":
      return {
        ...session,
        terminalRunIds: [...session.terminalRunIds, action.terminalRunId],
        phase: "verifying",
        resumeKind: "verification",
        updatedAt,
      };
    case "complete":
      return {
        ...session,
        phase: action.phase || "done",
        currentToolCall: undefined,
        pendingApprovalId: undefined,
        pendingQuestionId: undefined,
        resumeKind: undefined,
        updatedAt,
      };
  }
}
