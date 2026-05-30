import type { AgentLoopStatus } from "../domain/agentLoop";
import type { PlanTask, ReasoningEffort } from "../domain/types";
import type { LLMProvider, LLMRequestOptions } from "../services/llmService";
import { ToolLoopController, type ToolLoopCallbacks } from "./toolLoopController";

export type AgentTurnRunnerCallbacks = ToolLoopCallbacks;

export type PlanTurnResult =
  | { kind: "planDraft"; summary: string }
  | { kind: "question"; question: string }
  | { kind: "message"; message: string }
  | { kind: "done_plan"; summary: string };

export type BuildTurnResult =
  | { kind: "completed"; summary: string; finalSummary?: string; state: AgentTurnState; lastToolResult?: string }
  | { kind: "waitingAction"; waitingActionId?: string; lastToolResult?: string; state: AgentTurnState }
  | { kind: "cancelled"; summary?: string; state: AgentTurnState; lastToolResult?: string }
  | { kind: "failed"; error: string; state: AgentTurnState };

export interface BuildTurnInput {
  task: PlanTask;
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  threadId?: string;
  options?: LLMRequestOptions & { reasoningEffort?: ReasoningEffort };
  resumeContext?: string;
}

export interface AgentTurnState {
  mode: "plan" | "build" | null;
  status: "idle" | "running" | "waitingAction" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  error?: string;
  waitingActionId?: string;
  lastToolResult?: string;
}

export interface AgentBuildEngineAdapter {
  getStatus(): AgentLoopStatus;
  cancel(): void;
  runTask(
    task: PlanTask,
    provider: LLMProvider,
    model: string,
    baseUrl?: string,
    threadId?: string,
    options?: LLMRequestOptions & { reasoningEffort?: ReasoningEffort },
    resumeContext?: string,
  ): Promise<string>;
}

export type AgentBuildEngineFactory = (callbacks: AgentTurnRunnerCallbacks) => AgentBuildEngineAdapter;

export class AgentTurnRunner {
  private buildEngine: AgentBuildEngineAdapter;
  private turnState: AgentTurnState = { mode: null, status: "idle" };

  constructor(
    callbacks: AgentTurnRunnerCallbacks,
    buildEngineFactory: AgentBuildEngineFactory = (engineCallbacks) => {
      const controller = new ToolLoopController({
        ...engineCallbacks,
        getRuntimeMode: () => "build",
      });
      return {
        getStatus: () => controller.getStatus(),
        cancel: () => controller.cancel(),
        runTask: async (task, provider, model, baseUrl, threadId, options, resumeContext) => {
          const result = await controller.run({
            task,
            provider,
            model,
            baseUrl,
            threadId,
            options,
            resumeContext,
          });
          return result.summary;
        },
      };
    },
  ) {
    this.buildEngine = buildEngineFactory({
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

  async runBuildTurn(input: BuildTurnInput): Promise<BuildTurnResult> {
    this.turnState = { mode: "build", status: "running", startedAt: new Date().toISOString() };
    try {
      const result = await this.buildEngine.runTask(
        input.task,
        input.provider,
        input.model,
        input.baseUrl,
        input.threadId,
        input.options,
        input.resumeContext,
      );
      this.turnState = {
        ...this.turnState,
        status: this.turnState.status === "cancelled" ? "cancelled" : "completed",
        completedAt: new Date().toISOString(),
      };
      return this.turnState.status === "cancelled"
        ? { kind: "cancelled", summary: result, state: this.getTurnState() }
        : { kind: "completed", summary: result, finalSummary: result, state: this.getTurnState() };
    } catch (error) {
      this.turnState = {
        ...this.turnState,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      return {
        kind: "failed",
        error: this.turnState.error || "Build turn failed.",
        state: this.getTurnState(),
      };
    }
  }

  markWaitingAction(input: { actionId?: string; lastToolResult?: string } = {}): BuildTurnResult {
    this.turnState = {
      ...this.turnState,
      status: "waitingAction",
      waitingActionId: input.actionId,
      lastToolResult: input.lastToolResult,
    };
    return {
      kind: "waitingAction",
      waitingActionId: input.actionId,
      lastToolResult: input.lastToolResult,
      state: this.getTurnState(),
    };
  }

  async resumeBuildTurn(input: BuildTurnInput & { resumeContext: string }): Promise<BuildTurnResult> {
    return this.runBuildTurn(input);
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
