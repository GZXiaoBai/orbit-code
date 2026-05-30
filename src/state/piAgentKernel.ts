import type { ToolCall } from "../domain/agentLoop";
import type { PlanTask, ReasoningEffort } from "../domain/types";
import type { LLMProvider, LLMRequestOptions } from "../services/llmService";
import { AgentKernel } from "./agentKernel";
import type { BuildTurnResult, PlanTurnResult } from "./agentTurnRunner";
import type { ToolLoopCallbacks } from "./toolLoopController";

export type PiAgentKernelResult = BuildTurnResult;

export interface PiAgentKernelBuildInput {
  task: PlanTask;
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  threadId?: string;
  options?: LLMRequestOptions & { reasoningEffort?: ReasoningEffort };
  resumeContext?: string;
}

export interface PiAgentKernelPlanInput {
  prompt: string;
  planner: (prompt: string) => Promise<PlanTurnResult>;
}

export interface PiAgentKernelRuntimeState {
  running: boolean;
  lastToolCall?: ToolCall;
  lastResult?: PiAgentKernelResult | PlanTurnResult;
}

export class PiAgentKernel {
  constructor(private readonly kernel: AgentKernel) {}

  static fromCallbacks(callbacks: ToolLoopCallbacks): PiAgentKernel {
    return new PiAgentKernel(new AgentKernel(callbacks));
  }

  getState(): PiAgentKernelRuntimeState {
    return this.kernel.getState();
  }

  cancel(): void {
    this.kernel.cancel();
  }

  runPlanTurn(input: PiAgentKernelPlanInput): Promise<PlanTurnResult> {
    return this.kernel.runPlanTurn(input);
  }

  runBuildTurn(input: PiAgentKernelBuildInput): Promise<BuildTurnResult> {
    return this.kernel.runBuildTurn(input);
  }

  resumeTurn(input: PiAgentKernelBuildInput & { resumeContext: string }): Promise<BuildTurnResult> {
    return this.kernel.resumeTurn(input);
  }
}
