import { AgentLoopEngine, type AgentLoopCallbacks } from "./agentLoopEngine";
import type { PlanTask, ReasoningEffort } from "../domain/types";
import type { AgentLoopStatus } from "../domain/agentLoop";
import type { LLMProvider, LLMRequestOptions } from "../services/llmService";

export type BuildAgentEngineCallbacks = AgentLoopCallbacks;

export class BuildAgentEngine {
  private engine: AgentLoopEngine;

  constructor(callbacks: BuildAgentEngineCallbacks) {
    this.engine = new AgentLoopEngine({
      ...callbacks,
      getRuntimeMode: () => "build",
    });
  }

  getStatus(): AgentLoopStatus {
    return this.engine.getStatus();
  }

  cancel(): void {
    this.engine.cancel();
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
    return this.engine.runTask(task, provider, model, baseUrl, threadId, options, resumeContext);
  }
}
