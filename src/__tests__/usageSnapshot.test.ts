import { describe, expect, it } from "vitest";
import { buildUsageSnapshot } from "../state/usageSnapshot";
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
});
