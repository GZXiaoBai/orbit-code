import { describe, expect, it } from "vitest";
import { buildUsageSnapshot, codexUsageTokenRecords } from "../state/usageSnapshot";
import type { TerminalRun } from "../domain/terminalRun";

describe("usage snapshot", () => {
  it("summarizes local terminal runs and token records", () => {
    const runs: TerminalRun[] = [
      {
        id: "1",
        taskId: "task",
        command: "npm",
        args: ["test"],
        reason: "verify",
        status: "done",
        exitCode: 0,
        output: "ok",
        startedAt: "2026-05-25T01:00:00.000Z",
        completedAt: "2026-05-25T01:01:00.000Z",
      },
    ];

    expect(buildUsageSnapshot(runs, [{ totalTokens: 100 }, { totalTokens: 50 }])).toMatchObject({
      commandRuns: 1,
      terminalRuns: 1,
      llmTokens: 150,
      lastRunAt: "2026-05-25T01:01:00.000Z",
    });
  });

  it("converts Codex projection usage into workspace token records", () => {
    expect(codexUsageTokenRecords({ inputTokens: 30, outputTokens: 12, totalTokens: 42 })).toEqual([{ totalTokens: 42 }]);
    expect(buildUsageSnapshot([], codexUsageTokenRecords({ inputTokens: 30, outputTokens: 12, totalTokens: 42 }))).toMatchObject({
      commandRuns: 0,
      terminalRuns: 0,
      llmTokens: 42,
    });
    expect(codexUsageTokenRecords({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })).toEqual([]);
  });
});
