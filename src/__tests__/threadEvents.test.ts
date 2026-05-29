import { describe, expect, it } from "vitest";
import protocolSource from "../domain/threadEventProtocol.ts?raw";
import type { AgentEvent } from "../domain/agentEvents";
import {
  buildAgentEventsFromThreadEvents,
  buildThreadEvents,
  classifyThreadEvent,
  normalizeStoredThreadEvents,
  serializeThreadEvents,
  threadEventToAgentEvent,
} from "../domain/threadEvents";

function event(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: "event-1",
    role: "planner",
    name: "Agent",
    status: "done",
    message: "",
    timestamp: "12:00",
    ...overrides,
  };
}

describe("thread events", () => {
  it("keeps the public protocol free of legacy AgentEvent imports", () => {
    expect(protocolSource).not.toContain("AgentEvent");
  });

  it("classifies patch, command, question, verification, plan, and compaction events", () => {
    expect(classifyThreadEvent(event({ name: "Plan Ready" }))).toBe("plan");
    expect(classifyThreadEvent(event({ name: "Approval Gate", message: "run_command" }))).toBe("approvalRequest");
    expect(classifyThreadEvent(event({ name: "Approval Granted", message: "已批准命令" }))).toBe("approvalResult");
    expect(classifyThreadEvent(event({ name: "Final Summary" }))).toBe("finalSummary");
    expect(classifyThreadEvent(event({ name: "Question" }))).toBe("question");
    expect(classifyThreadEvent(event({ name: "Verification Approval" }))).toBe("verification");
    expect(classifyThreadEvent(event({ message: "Compressing conversation context..." }))).toBe("contextCompaction");
    expect(classifyThreadEvent(event({ name: "Recovered Waiting State", message: "approval" }))).toBe("commandExecution");
    expect(classifyThreadEvent(event({ name: "Waiting For Continue" }))).toBe("commandExecution");
    expect(classifyThreadEvent(event({
      name: "Patch Proposal",
      patches: [{ path: "src/App.tsx", oldContent: "", newContent: "export {}", applied: false }],
    }))).toBe("patchProposal");
  });

  it("preserves run scope fields for timeline and review dock consumers", () => {
    const [threadEvent] = buildThreadEvents([
      event({
        id: "approval-1",
        workspacePath: "/tmp/project",
        threadId: "thread-1",
        taskId: "task-1",
      runSessionId: "run-1",
      name: "Approval Gate",
      message: "等待命令审批",
      }),
    ]);

    expect(threadEvent).toMatchObject({
      id: "approval-1",
      kind: "approvalRequest",
      workspacePath: "/tmp/project",
      threadId: "thread-1",
      taskId: "task-1",
      runSessionId: "run-1",
      title: "Approval Gate",
    });
  });

  it("round-trips stored thread events back to legacy agent events", () => {
    const source = event({
      id: "patch-1",
      workspacePath: "/tmp/project",
      threadId: "thread-1",
      taskId: "task-1",
      runSessionId: "run-1",
      name: "Patch Proposal",
      message: "Review this patch",
      patches: [{ path: "src/App.tsx", oldContent: "old", newContent: "new", applied: false }],
    });
    const [threadEvent] = buildThreadEvents([source]);
    const [serialized] = serializeThreadEvents([threadEvent]);
    const restored = threadEventToAgentEvent({ ...threadEvent, sourceEvent: undefined });

    expect(serialized.sourceEvent).toBeUndefined();
    expect(restored).toMatchObject({
      id: "patch-1",
      workspacePath: "/tmp/project",
      threadId: "thread-1",
      taskId: "task-1",
      runSessionId: "run-1",
      name: "Patch Proposal",
      patches: [{ path: "src/App.tsx", oldContent: "old", newContent: "new", applied: false }],
    });
  });

  it("uses explicit question payloads instead of message classification for structured questions", () => {
    const [threadEvent] = buildThreadEvents([
      event({
        id: "question-1",
        name: "Agent",
        message: "Waiting for user input",
        question: {
          requestId: "request-1",
          question: "Pick a path",
          status: "pending",
          options: [{ id: "safe", label: "Safe path", description: "Run tests first.", recommended: true }],
        },
      }),
    ]);

    expect(threadEvent.kind).toBe("question");
    expect(threadEvent.question).toMatchObject({
      requestId: "request-1",
      question: "Pick a path",
      options: [{ id: "safe", label: "Safe path" }],
    });
    expect(threadEventToAgentEvent(threadEvent).question?.requestId).toBe("request-1");
  });

  it("prefers stored thread events and migrates legacy agent events", () => {
    const legacy = event({ id: "legacy-plan", name: "Plan Ready" });
    const stored = normalizeStoredThreadEvents({ agentEvents: [legacy] });
    expect(stored[0].kind).toBe("plan");

    const restoredLegacy = buildAgentEventsFromThreadEvents(stored);
    expect(restoredLegacy[0].name).toBe("Plan Ready");

    const preferred = normalizeStoredThreadEvents({
      threadEvents: [{ ...stored[0], id: "stored-plan" }],
      agentEvents: [legacy],
    });
    expect(preferred[0].id).toBe("stored-plan");
  });
});
