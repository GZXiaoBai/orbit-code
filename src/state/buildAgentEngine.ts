import type { PlanTask, ReasoningEffort } from "../domain/types";
import type { AgentLoopStatus } from "../domain/agentLoop";
import type { LLMProvider, LLMRequestOptions } from "../services/llmService";
import { AgentTurnRunner, type AgentTurnRunnerCallbacks } from "./agentTurnRunner";

export type BuildAgentEngineCallbacks = AgentTurnRunnerCallbacks;

export class BuildAgentEngine {
  private runner: AgentTurnRunner;

  constructor(callbacks: BuildAgentEngineCallbacks) {
    this.runner = new AgentTurnRunner(callbacks);
  }

  getStatus(): AgentLoopStatus {
    return this.runner.getStatus();
  }

  cancel(): void {
    this.runner.cancel();
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
    return this.runner.runBuildTurn(task, provider, model, baseUrl, threadId, options, resumeContext);
  }
}
