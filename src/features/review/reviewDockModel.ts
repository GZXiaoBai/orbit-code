import type { ActionRequiredEvent } from "../../domain/actionRequired";
import type { RuntimeLedgerSelectorSnapshot } from "../../domain/threadEventSelectors";
import type { ThreadEvent } from "../../domain/threadEvents";
import type { TerminalRun } from "../../domain/terminalRun";
import type { ApprovalGrant } from "../../domain/approvalGrant";

export interface ReviewDockInspectorModel {
  actionRequired: ActionRequiredEvent[];
  patchReviews: ThreadEvent[];
  appliedPatchReviews: ThreadEvent[];
  failedPatchReviews: ThreadEvent[];
  terminalRuns: TerminalRun[];
  historyTerminalRuns: TerminalRun[];
  historyPatchReviews: ThreadEvent[];
  checkpointEvents: ThreadEvent[];
  rollbackEvents: ThreadEvent[];
  activeGrants: ApprovalGrant[];
  counts: {
    changes: number;
    terminal: number;
    questions: number;
  };
}

function itemScope(input: { workspacePath?: string; threadId?: string; taskId?: string | null }) {
  return (item: { workspacePath?: string; threadId?: string; taskId?: string | null }) => {
    const workspaceMatches = !input.workspacePath || !item.workspacePath || item.workspacePath === input.workspacePath;
    const threadMatches = !input.threadId || !item.threadId || item.threadId === input.threadId;
    const taskMatches = !input.taskId || !item.taskId || item.taskId === input.taskId;
    return workspaceMatches && threadMatches && taskMatches;
  };
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
  ledger: RuntimeLedgerSelectorSnapshot;
  workspacePath?: string;
  threadId?: string;
  taskId?: string | null;
  approvalGrants?: ApprovalGrant[];
}): ReviewDockInspectorModel {
  const inScope = itemScope(input);
  const scopedEvents = input.ledger.threadEvents.filter((event) => inScope(event));
  const scopedActions = input.ledger.actionRequired.filter((action) => inScope(action));
  const scopedTerminalRuns = (input.ledger.terminalRuns || []).filter((run) => inScope(run));
  const historyTerminalRuns = (input.ledger.terminalRuns || []).filter((run) => !inScope(run));
  const patchEvents = scopedEvents.filter((event) => event.patches && event.patches.length > 0).reverse();
  const historyPatchReviews = input.ledger.threadEvents
    .filter((event) => event.patches && event.patches.length > 0 && !inScope(event))
    .reverse();
  const failedPatchReviews = patchEvents.filter(isTerminalFailedPatchReview);
  const patchReviews = patchEvents.filter((event) => event.patches?.some((patch) => !patch.applied));
  const appliedPatchReviews = patchEvents.filter((event) => event.patches?.length && event.patches.every((patch) => patch.applied));

  return {
    actionRequired: scopedActions,
    patchReviews,
    appliedPatchReviews,
    failedPatchReviews,
    terminalRuns: scopedTerminalRuns,
    historyTerminalRuns,
    historyPatchReviews,
    checkpointEvents: scopedEvents.filter((event) => event.kind === "checkpoint" || Boolean(event.checkpoint)).reverse(),
    rollbackEvents: scopedEvents.filter((event) => event.kind === "rollback").reverse(),
    activeGrants: (input.approvalGrants || []).filter((grant) =>
      (!input.workspacePath || !grant.workspacePath || grant.workspacePath === input.workspacePath)
      && (grant.scope !== "session" || !input.threadId || !grant.threadId || grant.threadId === input.threadId)
    ),
    counts: {
      changes: patchReviews.length,
      terminal: scopedTerminalRuns.length,
      questions: scopedActions.filter((action) => action.kind === "question" && action.status === "pending").length,
    },
  };
}
