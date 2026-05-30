import { describe, expect, it } from "vitest";
import {
  appendTerminalOutput,
  cancelTerminalRun,
  completeTerminalRun,
  createTerminalRun,
  recoverTerminalRun,
  terminalCancellationToolResult,
} from "../domain/terminalRun";

describe("terminal runs", () => {
  it("appends output and completes the latest running run for a task", () => {
    const run = createTerminalRun({
      taskId: "task-1",
      command: "npm",
      args: ["test"],
      at: "2026-05-25T00:00:00.000Z",
    });

    const withOutput = appendTerminalOutput([run], "task-1", "ok\n");
    const completed = completeTerminalRun(withOutput, "task-1", 0, "2026-05-25T00:00:01.000Z");

    expect(completed[0]).toMatchObject({
      output: "ok\n",
      status: "done",
      exitCode: 0,
      completedAt: "2026-05-25T00:00:01.000Z",
    });
  });

  it("maps restored running terminal runs to explicit continue state", () => {
    const recovered = recoverTerminalRun(createTerminalRun({
      taskId: "task-1",
      command: "npm",
      args: ["run", "dev"],
      output: "still running before reload\n",
      at: "2026-05-25T00:00:00.000Z",
    }));

    expect(recovered).toMatchObject({
      status: "cancelled",
      recoveredState: "unknown-needs-continue",
      outputTail: "still running before reload\n",
    });
  });

  it("cancels terminal runs with recovered cancellation state and stable tool result", () => {
    const run = createTerminalRun({
      taskId: "task-1",
      command: "npm",
      args: ["run", "dev"],
      output: "server output\n",
      at: "2026-05-25T00:00:00.000Z",
    });
    const cancelled = cancelTerminalRun([run], run.id, "2026-05-25T00:00:02.000Z")[0];

    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancelledAt: "2026-05-25T00:00:02.000Z",
      completedAt: "2026-05-25T00:00:02.000Z",
      recoveredState: "cancelled",
      outputTail: "server output\n",
    });
    expect(terminalCancellationToolResult(cancelled)).toBe("Cancelled command npm run dev: user cancelled the terminal run.");
  });
});
