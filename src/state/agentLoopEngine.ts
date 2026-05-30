import type { PlanTask, ReasoningEffort } from "../domain/types";
import type { AgentLoopStatus } from "../domain/agentLoop";
import type { LLMProvider, LLMRequestOptions } from "../services/llmService";
import {
  doneSummaryClaimsUncreatedPatch,
  parseToolCallsFromText,
  stripFabricatedToolResults,
  ToolLoopController,
  type ToolApprovalOutcome,
  type ToolLoopCallbacks,
} from "./toolLoopController";

export {
  doneSummaryClaimsUncreatedPatch,
  parseToolCallsFromText,
  stripFabricatedToolResults,
};

export type AgentLoopCallbacks = ToolLoopCallbacks;
export type { ToolApprovalOutcome };

export class AgentLoopEngine {
  private readonly controller: ToolLoopController;

  constructor(callbacks: AgentLoopCallbacks) {
    this.controller = new ToolLoopController(callbacks);
  }

  getStatus(): AgentLoopStatus {
    return this.controller.getStatus();
  }

  cancel(): void {
    this.controller.cancel();
  }

  runTask(
    task: PlanTask,
    provider: LLMProvider,
    model: string,
    baseUrl?: string,
    threadId?: string,
    options?: LLMRequestOptions & { reasoningEffort?: ReasoningEffort },
    resumeContext?: string,
  ): Promise<string> {
    return this.controller.runTask(
      task,
      provider,
      model,
      baseUrl,
      threadId,
      options,
      resumeContext,
    );
  }
}
