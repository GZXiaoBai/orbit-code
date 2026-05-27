import { formatCommandForDisplay } from "../runtime/commandParser";

export type TerminalRunStatus = "pending" | "running" | "done" | "failed" | "cancelled";

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
  };
}

export function appendTerminalOutput(runs: TerminalRun[], taskId: string, text: string): TerminalRun[] {
  const index = [...runs].reverse().findIndex((run) => run.taskId === taskId && run.status === "running");
  if (index === -1) return runs;
  const targetIndex = runs.length - 1 - index;
  return runs.map((run, runIndex) =>
    runIndex === targetIndex ? { ...run, output: run.output + text } : run
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
      ? { ...run, status: exitCode === 0 ? "done" : "failed", exitCode, completedAt: at }
      : run
  );
}
