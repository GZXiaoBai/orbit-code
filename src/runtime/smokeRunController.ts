import type { ActionRequiredEvent } from "../domain/actionRequired";
import type { ThreadEvent } from "../domain/threadEvents";
import {
  createDeepSeekSmokeRunRecord,
  type SmokeRunRecord,
} from "./deepSeekSmokeHarness";

export const DEFAULT_DEEPSEEK_SMOKE_WORKSPACE = "/Users/zhoujunjie/PersonalProjects/test for orbit/orbit-mini-lab";
export const DEFAULT_DEEPSEEK_SMOKE_TASK = "Plan read-only review, accept Build, approve command, answer structured question, review patch, apply, approve verification, run terminal, and produce final summary.";

export interface SmokeRunControllerInput {
  model: string;
  providerId?: string;
  workspacePath?: string;
  task?: string;
  threadId?: string;
  runSessionId?: string;
}

export interface SmokeRunControllerAdapter {
  run(input: Required<Pick<SmokeRunControllerInput, "model" | "workspacePath" | "task">> & SmokeRunControllerInput): Promise<{
    events: ThreadEvent[];
    actionRequired: ActionRequiredEvent[];
    threadId?: string;
    runSessionId?: string;
  }>;
}

export class SmokeRunController {
  constructor(private adapter: SmokeRunControllerAdapter) {}

  async run(input: SmokeRunControllerInput): Promise<SmokeRunRecord> {
    const startedAt = new Date().toISOString();
    const workspacePath = input.workspacePath || DEFAULT_DEEPSEEK_SMOKE_WORKSPACE;
    const task = input.task || DEFAULT_DEEPSEEK_SMOKE_TASK;
    const model = input.model;

    if (!model || /fixture/i.test(model) || /fixture/i.test(input.providerId || "")) {
      return createDeepSeekSmokeRunRecord({
        id: `deepseek-smoke-${Date.now()}-fixture-blocked`,
        model: model || "unknown",
        workspacePath,
        threadId: input.threadId,
        runSessionId: input.runSessionId,
        startedAt,
        completedAt: new Date().toISOString(),
        events: [],
        actionRequired: [],
      });
    }

    const output = await this.adapter.run({
      ...input,
      model,
      workspacePath,
      task,
    });

    return createDeepSeekSmokeRunRecord({
      model,
      workspacePath,
      threadId: output.threadId || input.threadId,
      runSessionId: output.runSessionId || input.runSessionId,
      startedAt,
      completedAt: new Date().toISOString(),
      events: output.events,
      actionRequired: output.actionRequired,
    });
  }
}
