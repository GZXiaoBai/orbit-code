import type { ThreadEvent } from "../../domain/threadEvents";
import type { QuestionRequest } from "../../domain/questionRequest";
import type { TerminalRun } from "../../domain/terminalRun";
import type { ApprovalRequest } from "../../state/useApprovalQueue";

export interface ReviewDockQueueModel {
  commandApprovals: ApprovalRequest[];
  questions: QuestionRequest[];
  patchReviews: ThreadEvent[];
  appliedPatchReviews: ThreadEvent[];
  failedPatchReviews: ThreadEvent[];
  verificationApprovals: ApprovalRequest[];
  otherApprovals: ApprovalRequest[];
  terminalRuns: TerminalRun[];
  historyTerminalRuns: TerminalRun[];
  historyPatchReviews: ThreadEvent[];
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

function isTerminalFailedPatchReview(event: ThreadEvent): boolean {
  const patches = event.patches || [];
  return patches.length > 0
    && patches.every((patch) =>
      !patch.applied
      && !patch.hasConflict
      && (patch.sandboxStatus === "failed" || patch.applyStatus === "failed")
    );
}

export function buildReviewDockModel(input: {
  approvals: ApprovalRequest[];
  questions: QuestionRequest[];
  events: ThreadEvent[];
  terminalRuns: TerminalRun[];
  workspacePath?: string;
  threadId?: string;
  taskId?: string | null;
}): ReviewDockQueueModel {
  const inScope = (item: {
    workspacePath?: string;
    threadId?: string;
    taskId?: string | null;
    params?: Record<string, unknown>;
  }) => {
    const workspacePath = item.workspacePath || (typeof item.params?.workspacePath === "string" ? item.params.workspacePath : undefined);
    const threadId = item.threadId || (typeof item.params?.threadId === "string" ? item.params.threadId : undefined);
    const taskId = item.taskId || (typeof item.params?.taskId === "string" ? item.params.taskId : undefined);
    const workspaceMatches = !input.workspacePath || !workspacePath || workspacePath === input.workspacePath;
    const threadMatches = !input.threadId || !threadId || threadId === input.threadId;
    const taskMatches = !input.taskId || !taskId || taskId === input.taskId;
    return workspaceMatches && threadMatches && taskMatches;
  };
  const scopedApprovals = input.approvals.filter((request) => inScope(request as ApprovalRequest & { params: Record<string, unknown> }));
  const scopedQuestions = input.questions.filter((question) => inScope(question));
  const scopedEvents = input.events.filter((event) => inScope(event));
  const scopedTerminalRuns = input.terminalRuns.filter((run) => inScope(run));
  const historyTerminalRuns = input.terminalRuns.filter((run) => !inScope(run));
  const scopedPendingApprovals = scopedApprovals.filter((request) => request.status === "pending");
  const verificationApprovals = scopedPendingApprovals.filter(isVerificationApproval);
  const commandApprovals = scopedPendingApprovals.filter((request) => request.tool === "run_command" && !isVerificationApproval(request));
  const otherApprovals = scopedPendingApprovals.filter((request) => request.tool !== "run_command");
  const questions = scopedQuestions.filter((question) => question.status === "pending");
  const patchEvents = scopedEvents.filter((event) => event.patches && event.patches.length > 0).reverse();
  const historyPatchReviews = input.events
    .filter((event) => event.patches && event.patches.length > 0 && !inScope(event))
    .reverse();
  const failedPatchReviews = patchEvents.filter(isTerminalFailedPatchReview);
  const patchReviews = patchEvents.filter((event) => event.patches?.some((patch) => !patch.applied));
  const appliedPatchReviews = patchEvents.filter((event) => event.patches?.length && event.patches.every((patch) => patch.applied));

  return {
    commandApprovals,
    questions,
    patchReviews,
    appliedPatchReviews,
    failedPatchReviews,
    verificationApprovals,
    otherApprovals,
    terminalRuns: scopedTerminalRuns,
    historyTerminalRuns,
    historyPatchReviews,
    counts: {
      changes: patchReviews.length,
      terminal: scopedTerminalRuns.length,
      questions: questions.length,
    },
  };
}
