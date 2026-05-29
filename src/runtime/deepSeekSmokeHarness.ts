import type { ActionRequiredEvent } from "../domain/actionRequired";
import type { ThreadEvent } from "../domain/threadEvents";

export type SmokeStage =
  | "planDraft"
  | "modeSwitch"
  | "approval"
  | "question"
  | "patchProposal"
  | "checkpoint"
  | "verification"
  | "terminalRun"
  | "doneBuild";

export interface SmokeFailureRecord {
  stage: SmokeStage;
  workspacePath: string;
  threadId?: string;
  runSessionId?: string;
  lastEventId?: string;
  pendingActionIds: string[];
  model: string;
  summary: string;
  nextFix: string;
}

export type SmokeRunResult = "passed" | "failed";

export interface SmokeRunRecord {
  id: string;
  model: string;
  workspacePath: string;
  threadId?: string;
  runSessionId?: string;
  startedAt: string;
  completedAt?: string;
  result: SmokeRunResult;
  failure?: SmokeFailureRecord;
  missingStages: SmokeStage[];
  lastEventId?: string;
  pendingActionIds: string[];
  terminalSummary?: string;
}

export interface SmokeHarnessInput {
  events: ThreadEvent[];
  actionRequired: ActionRequiredEvent[];
  workspacePath: string;
  model: string;
  threadId?: string;
  runSessionId?: string;
}

export interface SmokeHarnessResult {
  ok: boolean;
  missingStages: SmokeStage[];
  failure?: SmokeFailureRecord;
}

export const DEEPSEEK_SMOKE_STAGES: SmokeStage[] = [
  "planDraft",
  "modeSwitch",
  "approval",
  "question",
  "patchProposal",
  "checkpoint",
  "verification",
  "terminalRun",
  "doneBuild",
];

function hasStage(stage: SmokeStage, input: SmokeHarnessInput): boolean {
  const events = input.events;
  const actions = input.actionRequired;
  switch (stage) {
    case "planDraft":
      return events.some((event) => event.kind === "planDraft" && event.planDraft);
    case "modeSwitch":
      return events.some((event) => event.kind === "modeSwitch" && event.modeSwitch?.to === "build");
    case "approval":
      return actions.some((action) => ["command", "write", "install", "network"].includes(action.kind))
        || events.some((event) => event.kind === "approval" && event.approval);
    case "question":
      return actions.some((action) => action.kind === "question")
        || events.some((event) => event.kind === "question" && event.question);
    case "patchProposal":
      return events.some((event) => event.kind === "patchProposal" && event.patches?.length);
    case "checkpoint":
      return events.some((event) => event.kind === "checkpoint" || event.checkpoint);
    case "verification":
      return actions.some((action) => action.kind === "verification")
        || events.some((event) => event.kind === "verification" && event.verification);
    case "terminalRun":
      return events.some((event) => event.kind === "terminalRun" || event.terminalRun);
    case "doneBuild":
      return events.some((event) =>
        event.kind === "finalSummary"
        || event.kind === "agentMessage" && /done_build|final summary|最终总结|完成/i.test(event.title + "\n" + event.message)
      );
  }
}

function nextFixForStage(stage: SmokeStage): string {
  const fixes: Record<SmokeStage, string> = {
    planDraft: "Fix PlannerEngine or provider credentials until Plan mode produces a typed planDraft event.",
    modeSwitch: "Fix plan adoption so accepting the draft writes a modeSwitch event to Build.",
    approval: "Fix PermissionScheduler/ActionRequired wiring so Build command requests create a blocking approval.",
    question: "Fix ask_user handling so structured questions become ActionRequired question events.",
    patchProposal: "Fix Build tool execution so propose_patch creates a typed patchProposal with file summaries.",
    checkpoint: "Fix patch apply preflight so checkpoint events are recorded before writing files.",
    verification: "Fix post-patch verification so it creates a blocking verification action/event.",
    terminalRun: "Fix command execution recording so verification terminal output links back to the thread.",
    doneBuild: "Fix BuildAgentEngine continuation so the run ends with a typed final summary.",
  };
  return fixes[stage];
}

export function evaluateDeepSeekSmoke(input: SmokeHarnessInput): SmokeHarnessResult {
  const missingStages = DEEPSEEK_SMOKE_STAGES.filter((stage) => !hasStage(stage, input));
  if (missingStages.length === 0) return { ok: true, missingStages: [] };

  const stage = missingStages[0];
  const lastEvent = input.events[input.events.length - 1];
  return {
    ok: false,
    missingStages,
    failure: {
      stage,
      workspacePath: input.workspacePath,
      threadId: input.threadId,
      runSessionId: input.runSessionId,
      lastEventId: lastEvent?.id,
      pendingActionIds: input.actionRequired.filter((action) => action.status === "pending").map((action) => action.id),
      model: input.model,
      summary: `DeepSeek smoke is missing required stage: ${stage}.`,
      nextFix: nextFixForStage(stage),
    },
  };
}

export function createDeepSeekSmokeRunRecord(
  input: SmokeHarnessInput & {
    id?: string;
    startedAt?: string;
    completedAt?: string;
  },
): SmokeRunRecord {
  const evaluation = evaluateDeepSeekSmoke(input);
  const lastEvent = input.events[input.events.length - 1];
  const terminalEvents = input.events.filter((event) => event.kind === "terminalRun" || event.terminalRun);
  const lastTerminal = terminalEvents[terminalEvents.length - 1]?.terminalRun;
  const pendingActionIds = input.actionRequired
    .filter((action) => action.status === "pending")
    .map((action) => action.id);

  return {
    id: input.id || `deepseek-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    model: input.model,
    workspacePath: input.workspacePath,
    threadId: input.threadId,
    runSessionId: input.runSessionId,
    startedAt: input.startedAt || new Date().toISOString(),
    completedAt: input.completedAt || new Date().toISOString(),
    result: evaluation.ok ? "passed" : "failed",
    failure: evaluation.failure,
    missingStages: evaluation.missingStages,
    lastEventId: lastEvent?.id,
    pendingActionIds,
    terminalSummary: lastTerminal
      ? `${lastTerminal.command} ${(lastTerminal.args || []).join(" ")} -> ${lastTerminal.status}${typeof lastTerminal.exitCode === "number" ? ` (${lastTerminal.exitCode})` : ""}`
      : undefined,
  };
}
