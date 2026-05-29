import type { AgentLoopStatus } from "../domain/agentLoop";
import type { PlanTask, ReasoningEffort } from "../domain/types";
import type { LLMProvider, LLMRequestOptions } from "../services/llmService";
import { AgentLoopEngine, type AgentLoopCallbacks } from "./agentLoopEngine";

export type AgentTurnRunnerCallbacks = AgentLoopCallbacks;

export type PlanTurnResult =
  | { kind: "planDraft"; summary: string }
  | { kind: "question"; question: string }
  | { kind: "message"; message: string }
  | { kind: "done_plan"; summary: string };

export type BuildTurnResult =
  | { kind: "done_build"; summary: string }
  | { kind: "waiting"; reason: string };

export interface AgentTurnState {
  mode: "plan" | "build" | null;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export class AgentTurnRunner {
  private buildEngine: AgentLoopEngine;
  private turnState: AgentTurnState = { mode: null, status: "idle" };

  constructor(callbacks: AgentTurnRunnerCallbacks) {
    this.buildEngine = new AgentLoopEngine({
      ...callbacks,
      getRuntimeMode: () => "build",
    });
  }

  getStatus(): AgentLoopStatus {
    return this.buildEngine.getStatus();
  }

  cancel(): void {
    this.buildEngine.cancel();
    this.turnState = {
      ...this.turnState,
      status: "cancelled",
      completedAt: new Date().toISOString(),
    };
  }

  getTurnState(): AgentTurnState {
    return { ...this.turnState };
  }

  async runBuildTurn(
    task: PlanTask,
    provider: LLMProvider,
    model: string,
    baseUrl?: string,
    threadId?: string,
    options?: LLMRequestOptions & { reasoningEffort?: ReasoningEffort },
    resumeContext?: string,
  ): Promise<string> {
    this.turnState = { mode: "build", status: "running", startedAt: new Date().toISOString() };
    try {
      const result = await this.buildEngine.runTask(task, provider, model, baseUrl, threadId, options, resumeContext);
      this.turnState = {
        ...this.turnState,
        status: this.turnState.status === "cancelled" ? "cancelled" : "completed",
        completedAt: new Date().toISOString(),
      };
      return result;
    } catch (error) {
      this.turnState = {
        ...this.turnState,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  async runPlanTurn(input: {
    prompt: string;
    planner: (prompt: string) => Promise<PlanTurnResult>;
  }): Promise<PlanTurnResult> {
    this.turnState = { mode: "plan", status: "running", startedAt: new Date().toISOString() };
    try {
      const result = await input.planner(input.prompt);
      this.turnState = {
        ...this.turnState,
        status: "completed",
        completedAt: new Date().toISOString(),
      };
      return result;
    } catch (error) {
      this.turnState = {
        ...this.turnState,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }
}
