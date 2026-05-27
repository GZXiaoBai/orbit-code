import { describe, expect, it } from "vitest";
import { createTerminalRun } from "../domain/terminalRun";
import { copy } from "../i18n/copy";
import { terminalStatusLabel } from "../features/review/TerminalRunList";

describe("terminal run list", () => {
  it("labels non-zero completed commands as failed", () => {
    const run = createTerminalRun({
      taskId: "task-1",
      command: "npm",
      args: ["test"],
      status: "done",
      exitCode: 1,
    });

    expect(terminalStatusLabel(copy.zh, run)).toBe(copy.zh.terminal.failed);
  });
});
