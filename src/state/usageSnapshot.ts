import type { UsageSnapshot } from "../domain/types";
import type { TerminalRun } from "../domain/terminalRun";

export function codexUsageTokenRecords(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null | undefined): Array<{ totalTokens: number }> {
  const totalTokens = usage?.totalTokens || 0;
  return totalTokens > 0 ? [{ totalTokens }] : [];
}

export function buildUsageSnapshot(terminalRuns: TerminalRun[], tokenRecords: Array<{ totalTokens?: number }> = []): UsageSnapshot {
  const llmTokens = tokenRecords.reduce((sum, record) => sum + (record.totalTokens || 0), 0);
  const lastTerminal = [...terminalRuns].sort((a, b) => (b.completedAt || b.startedAt).localeCompare(a.completedAt || a.startedAt))[0];
  return {
    commandRuns: terminalRuns.filter((run) => run.command).length,
    terminalRuns: terminalRuns.length,
    llmTokens: llmTokens || undefined,
    lastRunAt: lastTerminal?.completedAt || lastTerminal?.startedAt,
  };
}
