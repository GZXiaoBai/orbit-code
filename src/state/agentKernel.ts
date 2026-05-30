import type { ToolCall } from "../domain/agentLoop";
import type { PlanTask, ReasoningEffort } from "../domain/types";
import type { LLMProvider, LLMRequestOptions } from "../services/llmService";
import { AgentTurnRunner, type BuildTurnResult, type PlanTurnResult } from "./agentTurnRunner";
import type { ToolLoopCallbacks } from "./toolLoopController";

export type AgentKernelResult = BuildTurnResult;

export interface AgentKernelBuildInput {
  task: PlanTask;
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  threadId?: string;
  options?: LLMRequestOptions & { reasoningEffort?: ReasoningEffort };
  resumeContext?: string;
}

export interface AgentKernelPlanInput {
  prompt: string;
  planner: (prompt: string) => Promise<PlanTurnResult>;
}

export interface AgentKernelRuntimeState {
  running: boolean;
  lastToolCall?: ToolCall;
  lastResult?: AgentKernelResult | PlanTurnResult;
}

export class AgentKernel {
  private readonly runner: AgentTurnRunner;
  private runtimeState: AgentKernelRuntimeState = { running: false };

  constructor(callbacks: ToolLoopCallbacks) {
    this.runner = new AgentTurnRunner(callbacks);
  }

  getState(): AgentKernelRuntimeState {
    return { ...this.runtimeState };
  }

  cancel(): void {
    this.runner.cancel();
    this.runtimeState = { ...this.runtimeState, running: false };
  }

  async runPlanTurn(input: AgentKernelPlanInput): Promise<PlanTurnResult> {
    this.runtimeState = { ...this.runtimeState, running: true };
    try {
      const result = await this.runner.runPlanTurn(input);
      this.runtimeState = { ...this.runtimeState, running: false, lastResult: result };
      return result;
    } catch (error) {
      this.runtimeState = { ...this.runtimeState, running: false };
      throw error;
    }
  }

  async runBuildTurn(input: AgentKernelBuildInput): Promise<BuildTurnResult> {
    this.runtimeState = { ...this.runtimeState, running: true };
    const result = await this.runner.runBuildTurn(input);
    this.runtimeState = { ...this.runtimeState, running: false, lastResult: result };
    return result;
  }

  async resumeTurn(input: AgentKernelBuildInput & { resumeContext: string }): Promise<BuildTurnResult> {
    this.runtimeState = { ...this.runtimeState, running: true };
    const result = await this.runner.resumeBuildTurn(input);
    this.runtimeState = { ...this.runtimeState, running: false, lastResult: result };
    return result;
  }
}
