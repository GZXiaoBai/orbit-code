import type { AgentLoopPhase, ToolCall } from "./agentLoop";

export interface AgentRunSession {
  id: string;
  workspacePath?: string;
  threadId?: string;
  taskId: string | null;
  phase: AgentLoopPhase;
  iteration?: number;
  conversationSummary?: string;
  currentToolCall?: ToolCall;
  pendingApprovalId?: string;
  pendingQuestionId?: string;
  resumeKind?: "approval" | "question" | "patchReview" | "verification";
  resumeAction?: {
    type: "approval" | "question" | "patchReview" | "verification";
    payloadId?: string;
  };
  canContinue?: boolean;
  lastToolResult?: string;
  patchProposalIds: string[];
  terminalRunIds: string[];
  updatedAt: string;
}

export type AgentRunSessionAction =
  | { type: "start"; taskId: string; workspacePath?: string; threadId?: string; runSessionId?: string; at?: string }
  | { type: "resume"; at?: string }
  | { type: "phase"; phase: AgentLoopPhase; at?: string }
  | { type: "iteration"; iteration: number; conversationSummary?: string; at?: string }
  | { type: "tool"; toolCall?: ToolCall; at?: string }
  | { type: "approval"; approvalId?: string; at?: string }
  | { type: "question"; questionId?: string; at?: string }
  | { type: "patch"; patchProposalId: string; at?: string }
  | { type: "terminal"; terminalRunId: string; at?: string }
  | {
      type: "pauseForContinue";
      resumeKind: NonNullable<AgentRunSession["resumeKind"]>;
      resumeAction?: AgentRunSession["resumeAction"];
      lastToolResult?: string;
      at?: string;
    }
  | { type: "continue"; at?: string }
  | { type: "complete"; phase?: AgentLoopPhase; at?: string }
  | { type: "recover"; session: AgentRunSession };

export function createAgentRunSession(at = new Date().toISOString()): AgentRunSession {
  return {
    id: `run-${at}-${Math.random().toString(36).slice(2, 8)}`,
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
        id: action.runSessionId || `run-${updatedAt}-${Math.random().toString(36).slice(2, 8)}`,
        workspacePath: action.workspacePath,
        threadId: action.threadId,
        taskId: action.taskId,
        phase: "planning",
        iteration: 0,
        conversationSummary: undefined,
        resumeKind: undefined,
        resumeAction: undefined,
        canContinue: false,
        lastToolResult: undefined,
        patchProposalIds: [],
        terminalRunIds: [],
        updatedAt,
      };
    case "resume":
      return {
        ...session,
        phase: "planning",
        currentToolCall: undefined,
        canContinue: false,
        lastToolResult: undefined,
        updatedAt,
      };
    case "phase":
      return { ...session, phase: action.phase, updatedAt };
    case "iteration":
      return {
        ...session,
        iteration: action.iteration,
        conversationSummary: action.conversationSummary ?? session.conversationSummary,
        updatedAt,
      };
    case "tool":
      return { ...session, currentToolCall: action.toolCall, updatedAt };
    case "approval":
      return {
        ...session,
        pendingApprovalId: action.approvalId,
        resumeKind: action.approvalId ? "approval" : undefined,
        resumeAction: action.approvalId ? { type: "approval", payloadId: action.approvalId } : undefined,
        canContinue: false,
        updatedAt,
      };
    case "question":
      return {
        ...session,
        pendingQuestionId: action.questionId,
        resumeKind: action.questionId ? "question" : undefined,
        resumeAction: action.questionId ? { type: "question", payloadId: action.questionId } : undefined,
        canContinue: false,
        updatedAt,
      };
    case "patch":
      return {
        ...session,
        patchProposalIds: [...session.patchProposalIds, action.patchProposalId],
        phase: "reviewing",
        resumeKind: "patchReview",
        resumeAction: { type: "patchReview", payloadId: action.patchProposalId },
        canContinue: false,
        updatedAt,
      };
    case "terminal":
      return {
        ...session,
        terminalRunIds: [...session.terminalRunIds, action.terminalRunId],
        phase: "verifying",
        resumeKind: "verification",
        resumeAction: { type: "verification", payloadId: action.terminalRunId },
        canContinue: false,
        updatedAt,
      };
    case "pauseForContinue":
      return {
        ...session,
        resumeKind: action.resumeKind,
        resumeAction: action.resumeAction,
        canContinue: true,
        lastToolResult: action.lastToolResult,
        updatedAt,
      };
    case "continue":
      return {
        ...session,
        resumeKind: undefined,
        resumeAction: undefined,
        canContinue: false,
        lastToolResult: undefined,
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
        resumeAction: undefined,
        canContinue: false,
        lastToolResult: undefined,
        updatedAt,
      };
  }
}
