import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "../domain/threadEvents";
import { createActionRequiredEvent } from "../domain/actionRequired";
import {
  selectCenterTimeline,
  selectCheckpointBrowserModel,
  selectContextMemoryModel,
  selectInspectorModel,
  selectPendingActions,
} from "../domain/threadEventSelectors";

function event(overrides: Partial<ThreadEvent>): ThreadEvent {
  return {
    id: overrides.id || "event-1",
    kind: overrides.kind || "agentMessage",
    role: overrides.role || "planner",
    status: overrides.status || "done",
    title: overrides.title || "Event",
    message: overrides.message || "Message",
    timestamp: overrides.timestamp || "10:00:00",
    ...overrides,
  };
}

describe("threadEventSelectors", () => {
  it("keeps raw tool params and terminal output out of the center timeline", () => {
    const visible = event({ id: "visible", kind: "agentMessage" });
    const rawTool = event({
      id: "tool",
      kind: "toolCall",
      toolCall: {
        id: "call-1",
        name: "run_command",
        params: { command: "npm", args: ["test"] },
        status: "pending",
      },
    });
    const rawTerminal = event({
      id: "terminal",
      kind: "terminalRun",
      terminalRun: {
        id: "terminal-1",
        taskId: "task-1",
        command: "npm",
        args: ["test"],
        reason: "verify",
        status: "done",
        exitCode: 0,
        output: "large output",
        startedAt: "2026-05-29T00:00:00.000Z",
      },
    });

    expect(selectCenterTimeline([visible, rawTool, rawTerminal]).map((item) => item.id)).toEqual(["visible"]);
  });

  it("projects pending actions and inspector history from the same events", () => {
    const patch = event({
      id: "patch-1",
      kind: "patchProposal",
      title: "Patch Proposal",
      patches: [{ path: "src/a.ts", oldContent: "a", newContent: "b", applied: false }],
    });
    const rollback = event({
      id: "rollback-1",
      kind: "rollback",
      title: "Patch Rollback",
      rollback: {
        checkpointId: "checkpoint-1",
        filePaths: ["src/a.ts"],
        status: "pending",
        actor: "user",
      },
    });

    expect(selectPendingActions({
      threadEvents: [patch, rollback],
      actionRequired: [],
      toolCalls: [],
      terminalRuns: [],
      checkpoints: [],
    }).map((item) => item.kind)).toEqual(["patch", "rollback"]);
    const inspector = selectInspectorModel([patch, rollback], "patch-1");
    expect(inspector.selectedEvent?.id).toBe("patch-1");
    expect(inspector.patchEvents.map((item) => item.id)).toEqual(["patch-1"]);
    expect(inspector.rollbackEvents.map((item) => item.id)).toEqual(["rollback-1"]);
  });

  it("projects pending actions from ActionRequired without approval/question queues", () => {
    const actions = selectPendingActions({
      threadEvents: [],
      actionRequired: [
        createActionRequiredEvent({
          id: "action-1",
          kind: "install",
          tool: "run_command",
          title: "Install dependency",
          description: "npm install",
        }),
      ],
      toolCalls: [],
      terminalRuns: [],
      checkpoints: [],
    });

    expect(actions).toEqual([
      expect.objectContaining({
        id: "action:action-1",
        kind: "approval",
        title: "Install dependency",
      }),
    ]);
  });

  it("projects center, pending actions, inspector, and checkpoints from one ledger snapshot", () => {
    const checkpoint = event({
      id: "checkpoint-event",
      kind: "checkpoint",
      checkpoint: {
        checkpointId: "checkpoint-1",
        strategy: "git-shadow",
        filePaths: ["src/App.tsx"],
        status: "created",
      },
    });
    const snapshot = {
      threadEvents: [checkpoint],
      actionRequired: [createActionRequiredEvent({
        id: "verification-1",
        kind: "verification",
        tool: "run_command",
        title: "Verify",
        description: "npm test",
      })],
      toolCalls: [{
        id: "tool-1",
        tool: "run_command",
        status: "actionRequired" as const,
        actionRequiredId: "verification-1",
        createdAt: "2026-05-29T00:00:00.000Z",
      }],
      terminalRuns: [],
      checkpoints: [checkpoint],
    };

    expect(selectCenterTimeline(snapshot).map((item) => item.id)).toEqual(["checkpoint-event"]);
    expect(selectPendingActions(snapshot)).toEqual([
      expect.objectContaining({ id: "action:verification-1", kind: "verification" }),
    ]);
    expect(selectInspectorModel(snapshot).toolCalls).toEqual([
      expect.objectContaining({ id: "tool-1", status: "actionRequired" }),
    ]);
    expect(selectCheckpointBrowserModel(snapshot).restorePreview).toMatchObject({
      checkpointId: "checkpoint-1",
      canRestore: true,
    });
  });

  it("projects context memory without granting permission impact", () => {
    const model = selectContextMemoryModel({
      blocks: [{
        id: "orbit",
        title: "ORBIT.md",
        source: "project",
        content: "Use tests.",
        permissionImpact: "none",
      }],
      disabledBlocks: [],
      skills: [],
      editableSources: [],
      externalRuleCandidates: [],
      source: "runtime",
      mode: "plan",
      tokenEstimate: 3,
      errors: [],
      matchedRules: [],
      permissionImpact: "none",
      lastCollectedAt: "2026-05-29T00:00:00.000Z",
    }, [{ path: "AGENTS.md", title: "AGENTS.md" }]);

    expect(model.permissionImpact).toBe("none");
    expect(model.memories.map((block) => block.title)).toEqual(["ORBIT.md"]);
    expect(model.externalRuleCandidates).toEqual([
      { path: "AGENTS.md", title: "AGENTS.md", enabled: false },
    ]);
  });
});
