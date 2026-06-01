export type WorkbenchMode = "plan" | "build";

export type ToolParamValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | Array<Record<string, unknown>>
  | Record<string, unknown>;

export type ToolParams = Record<string, ToolParamValue>;

export type CodexRunPhase =
  | "idle"
  | "starting"
  | "reasoning"
  | "executing"
  | "waiting_approval"
  | "verifying"
  | "done"
  | "error"
  | "cancelled";

export interface LiveToolCall {
  id: string;
  name: string;
  params: ToolParams;
  result?: string;
  error?: string;
  status: "pending" | "running" | "done" | "error";
  startedAt?: string;
  completedAt?: string;
}

export interface RuntimeToolSummaryInput {
  id: string;
  tool: string;
  status: string;
  argsSummary?: string;
  resultText?: string;
  error?: string;
  actionRequiredId?: string;
  threadEventId?: string;
  createdAt: string;
  updatedAt?: string;
}
