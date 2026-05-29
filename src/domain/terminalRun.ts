import { formatCommandForDisplay } from "../runtime/commandParser";

export type TerminalRunStatus = "pending" | "running" | "done" | "failed" | "cancelled";
export type TerminalRecoveredState = "completed" | "cancelled" | "unknown-needs-continue";

export interface TerminalRun {
  id: string;
  workspacePath?: string;
  threadId?: string;
  taskId: string;
  approvalId?: string;
  cwd?: string;
  command: string;
  args: string[];
  reason: string;
  status: TerminalRunStatus;
  exitCode: number | null;
  output: string;
  startedAt: string;
  completedAt?: string;
  processId?: string;
  sessionId?: string;
  cancelledAt?: string;
  outputTail?: string;
  recoveredState?: TerminalRecoveredState;
}

export function createTerminalRun(input: {
  workspacePath?: string;
  threadId?: string;
  taskId: string;
  approvalId?: string;
  cwd?: string;
  command: string;
  args?: string[];
  reason?: string;
  output?: string;
  status?: TerminalRunStatus;
  exitCode?: number | null;
  at?: string;
  processId?: string;
  sessionId?: string;
  cancelledAt?: string;
  recoveredState?: TerminalRecoveredState;
}): TerminalRun {
  const startedAt = input.at || new Date().toISOString();
  return {
    id: `terminal-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    workspacePath: input.workspacePath,
    threadId: input.threadId,
    taskId: input.taskId,
    approvalId: input.approvalId,
    cwd: input.cwd,
    command: input.command,
    args: input.args || [],
    reason: input.reason || formatCommandForDisplay(input.command, input.args || []),
    status: input.status || "running",
    exitCode: input.exitCode ?? null,
    output: input.output || "",
    startedAt,
    completedAt: input.status && input.status !== "running" ? startedAt : undefined,
    processId: input.processId,
    sessionId: input.sessionId,
    cancelledAt: input.cancelledAt,
    outputTail: (input.output || "").slice(-4000),
    recoveredState: input.recoveredState,
  };
}

export function appendTerminalOutput(runs: TerminalRun[], taskId: string, text: string): TerminalRun[] {
  const index = [...runs].reverse().findIndex((run) => run.taskId === taskId && run.status === "running");
  if (index === -1) return runs;
  const targetIndex = runs.length - 1 - index;
  return runs.map((run, runIndex) =>
    runIndex === targetIndex ? { ...run, output: run.output + text, outputTail: (run.output + text).slice(-4000) } : run
  );
}

export function completeTerminalRun(
  runs: TerminalRun[],
  taskId: string,
  exitCode: number | null,
  at = new Date().toISOString(),
): TerminalRun[] {
  const index = [...runs].reverse().findIndex((run) => run.taskId === taskId && run.status === "running");
  if (index === -1) return runs;
  const targetIndex = runs.length - 1 - index;
  return runs.map((run, runIndex) =>
    runIndex === targetIndex
      ? { ...run, status: exitCode === 0 ? "done" : "failed", exitCode, completedAt: at, outputTail: run.output.slice(-4000) }
      : run
  );
}

export function recoverTerminalRun(run: TerminalRun): TerminalRun {
  if (run.status === "running") {
    return {
      ...run,
      status: "cancelled",
      recoveredState: "unknown-needs-continue",
      outputTail: (run.output || run.outputTail || "").slice(-4000),
    };
  }
  return {
    ...run,
    recoveredState: run.recoveredState || (run.status === "cancelled" ? "cancelled" : "completed"),
    outputTail: (run.outputTail || run.output || "").slice(-4000),
  };
}

export function cancelTerminalRun(
  runs: TerminalRun[],
  runId: string,
  at = new Date().toISOString(),
): TerminalRun[] {
  return runs.map((run) =>
    run.id === runId || run.taskId === runId
      ? {
        ...run,
        status: "cancelled",
        exitCode: run.exitCode ?? null,
        cancelledAt: at,
        completedAt: run.completedAt || at,
        recoveredState: "cancelled",
        outputTail: (run.output || run.outputTail || "").slice(-4000),
      }
      : run
  );
}
