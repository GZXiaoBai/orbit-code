import { describe, expect, it } from "vitest";
import { createActionRequiredEvent } from "../domain/actionRequired";
import type { ThreadEvent } from "../domain/threadEvents";
import { createDeepSeekSmokeRunRecord, evaluateDeepSeekSmoke } from "../runtime/deepSeekSmokeHarness";

function event(overrides: Partial<ThreadEvent>): ThreadEvent {
  return {
    id: overrides.id || "event-1",
    kind: overrides.kind || "agentMessage",
    role: overrides.role || "planner",
    status: overrides.status || "done",
    title: overrides.title || "Event",
    message: overrides.message || "Message",
    timestamp: "12:00:00",
    ...overrides,
  };
}

describe("deepSeekSmokeHarness", () => {
  it("returns a failure ledger record for the first missing stage", () => {
    const result = evaluateDeepSeekSmoke({
      workspacePath: "/Users/zhoujunjie/PersonalProjects/test for orbit/orbit-mini-lab",
      model: "deepseek-v4-flash",
      events: [],
      actionRequired: [],
    });

    expect(result.ok).toBe(false);
    expect(result.failure).toMatchObject({
      stage: "planDraft",
      model: "deepseek-v4-flash",
      pendingActionIds: [],
    });
    expect(result.failure?.nextFix).toContain("PlannerEngine");
  });

  it("passes when the full typed DeepSeek loop is present", () => {
    const events: ThreadEvent[] = [
      event({ id: "plan", kind: "planDraft", planDraft: {
        version: "1",
        title: "Plan",
        goals: [],
        constraints: [],
        tasks: [],
        acceptanceCriteria: [],
        risks: [],
        references: [],
      } }),
      event({ id: "switch", kind: "modeSwitch", modeSwitch: { from: "plan", to: "build" } }),
      event({ id: "question", kind: "question", question: { question: "Which task?", status: "answered" } }),
      event({ id: "patch", kind: "patchProposal", patches: [{ path: "README.md", oldContent: "", newContent: "ok", applied: true }] }),
      event({ id: "checkpoint", kind: "checkpoint", checkpoint: { checkpointId: "c1", strategy: "file-snapshot", filePaths: ["README.md"], status: "created" } }),
      event({ id: "verification", kind: "verification", verification: { command: "npm", args: ["test"], status: "approved" } }),
      event({ id: "terminal", kind: "terminalRun", terminalRun: {
        id: "t1",
        taskId: "task-1",
        command: "npm",
        args: ["test"],
        reason: "verify",
        status: "done",
        exitCode: 0,
        output: "ok",
        startedAt: "2026-05-29T00:00:00.000Z",
      } }),
      event({ id: "final", kind: "finalSummary", title: "Final Summary", message: "Done" }),
    ];
    const actionRequired = [
      createActionRequiredEvent({
        id: "approval",
        kind: "command",
        tool: "run_command",
        title: "Run command",
        description: "npm test",
        status: "approved",
      }),
    ];

    expect(evaluateDeepSeekSmoke({
      workspacePath: "/workspace",
      model: "deepseek-v4-flash",
      events,
      actionRequired,
    })).toEqual({ ok: true, missingStages: [] });
  });

  it("creates a durable smoke run record with terminal and failure details", () => {
    const record = createDeepSeekSmokeRunRecord({
      id: "smoke-1",
      workspacePath: "/workspace",
      model: "deepseek-v4-flash",
      startedAt: "2026-05-29T00:00:00.000Z",
      completedAt: "2026-05-29T00:01:00.000Z",
      events: [
        event({ id: "plan", kind: "planDraft", planDraft: {
          version: "1",
          title: "Plan",
          goals: [],
          constraints: [],
          tasks: [],
          acceptanceCriteria: [],
          risks: [],
          references: [],
        } }),
        event({ id: "terminal", kind: "terminalRun", terminalRun: {
          id: "t1",
          taskId: "task-1",
          command: "npm",
          args: ["test"],
          reason: "verify",
          status: "failed",
          exitCode: 1,
          output: "failed",
          startedAt: "2026-05-29T00:00:30.000Z",
        } }),
      ],
      actionRequired: [createActionRequiredEvent({
        id: "approval-1",
        kind: "command",
        tool: "run_command",
        title: "Run command",
        description: "npm test",
      })],
    });

    expect(record).toMatchObject({
      id: "smoke-1",
      result: "failed",
      missingStages: expect.arrayContaining(["modeSwitch"]),
      lastEventId: "terminal",
      pendingActionIds: ["approval-1"],
      terminalSummary: "npm test -> failed (1)",
    });
    expect(record.failure?.stage).toBe("modeSwitch");
  });
});
