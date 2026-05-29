import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../domain/agentEvents";
import type { ThreadEvent } from "../domain/threadEvents";
import {
  appendThreadEvent,
  applyLegacyAgentEventUpdate,
  restoreThreadEventStore,
  threadEventsToLegacyAgentEvents,
  updateThreadEventById,
} from "../state/threadEventStore";

function legacy(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: "agent-1",
    role: "planner",
    name: "Plan Ready",
    status: "done",
    message: "Ready",
    timestamp: "12:00",
    ...overrides,
  };
}

describe("ThreadEventStore", () => {
  it("restores stored thread events before legacy agent events", () => {
    const stored: ThreadEvent = {
      id: "thread-1",
      kind: "planDraft",
      role: "planner",
      status: "done",
      title: "Plan Draft",
      message: "Draft",
      timestamp: "12:01",
    };

    const restored = restoreThreadEventStore({
      threadEvents: [stored],
      agentEvents: [legacy({ id: "legacy-1" })],
    });

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: "thread-1", kind: "planDraft" });
  });

  it("migrates legacy AgentEvent updates into ThreadEvent state", () => {
    const current = restoreThreadEventStore({ agentEvents: [legacy()] });
    const next = applyLegacyAgentEventUpdate(current, (events) => [
      ...events,
      legacy({ id: "patch-1", name: "Patch Proposal", patches: [{ path: "a.ts", oldContent: "", newContent: "x", applied: false }] }),
    ]);

    expect(next.map((event) => event.kind)).toEqual(["plan", "patchProposal"]);
    expect(threadEventsToLegacyAgentEvents(next)[1].patches?.[0].path).toBe("a.ts");
  });

  it("appends and updates first-class events without regex classification", () => {
    const current = appendThreadEvent([], {
      id: "approval-1",
      kind: "approval",
      role: "reviewer",
      status: "thinking",
      title: "Approval",
      message: "Pending",
      timestamp: "12:00",
    });
    const next = updateThreadEventById(current, "approval-1", { status: "done", message: "Approved" });

    expect(next[0]).toMatchObject({ kind: "approval", status: "done", message: "Approved" });
  });
});
