import type { AgentEvent } from "../../domain/agentEvents";
import type { QuestionRequest } from "../../domain/questionRequest";
import type { TerminalRun } from "../../domain/terminalRun";
import type { ApprovalRequest } from "../../state/useApprovalQueue";

export interface ReviewDockQueueModel {
  commandApprovals: ApprovalRequest[];
  questions: QuestionRequest[];
  patchReviews: AgentEvent[];
  appliedPatchReviews: AgentEvent[];
  verificationApprovals: ApprovalRequest[];
  otherApprovals: ApprovalRequest[];
  terminalRuns: TerminalRun[];
  counts: {
    changes: number;
    terminal: number;
    questions: number;
  };
}

function isVerificationApproval(request: ApprovalRequest): boolean {
  return request.tool === "run_command"
    && typeof request.params.sourceEventId === "string"
    && request.params.sourceEventId.length > 0;
}

export function buildReviewDockModel(input: {
  approvals: ApprovalRequest[];
  questions: QuestionRequest[];
  events: AgentEvent[];
  terminalRuns: TerminalRun[];
}): ReviewDockQueueModel {
  const pendingApprovals = input.approvals.filter((request) => request.status === "pending");
  const verificationApprovals = pendingApprovals.filter(isVerificationApproval);
  const commandApprovals = pendingApprovals.filter((request) => request.tool === "run_command" && !isVerificationApproval(request));
  const otherApprovals = pendingApprovals.filter((request) => request.tool !== "run_command");
  const questions = input.questions.filter((question) => question.status === "pending");
  const patchEvents = input.events.filter((event) => event.patches && event.patches.length > 0);
  const patchReviews = patchEvents.filter((event) => event.patches?.some((patch) => !patch.applied));
  const appliedPatchReviews = patchEvents.filter((event) => event.patches?.length && event.patches.every((patch) => patch.applied));

  return {
    commandApprovals,
    questions,
    patchReviews,
    appliedPatchReviews,
    verificationApprovals,
    otherApprovals,
    terminalRuns: input.terminalRuns,
    counts: {
      changes: commandApprovals.length + questions.length + patchReviews.length + verificationApprovals.length + otherApprovals.length,
      terminal: input.terminalRuns.length,
      questions: questions.length,
    },
  };
}
