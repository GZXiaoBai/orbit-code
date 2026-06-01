import type {
  ThreadEventKind,
  ThreadEventProtocol,
  ThreadEventStatus,
} from "./threadEventProtocol";

export type {
  ThreadApprovalPayload,
  ThreadCheckpointPayload,
  ThreadEventKind,
  ThreadEventProtocol,
  ThreadEventRole,
  ThreadEventStatus,
  RuntimeItemStatus,
  ThreadModeSwitchPayload,
  ThreadPatch,
  ThreadQuestion,
  ThreadQuestionOption,
  ThreadRollbackPayload,
  ThreadToolCallPayload,
  ThreadToolDeniedPayload,
  ThreadTaskProgressPayload,
  ThreadTodoItem,
  ThreadTodoListPayload,
  ThreadVerificationPayload,
  TodoItemStatus,
} from "./threadEventProtocol";

export type ThreadEvent = ThreadEventProtocol;

export type CreateThreadEventInput = Omit<ThreadEvent, "id" | "timestamp" | "role" | "status"> & {
  id?: string;
  role?: ThreadEvent["role"];
  status?: ThreadEventStatus;
  timestamp?: string;
};

export function createThreadEvent(input: CreateThreadEventInput): ThreadEvent {
  return {
    ...input,
    id: input.id || `${input.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: input.role || "planner",
    status: input.status || "done",
    timestamp: input.timestamp || new Date().toLocaleTimeString(),
  };
}

export function serializeThreadEvents(events: ThreadEvent[]): ThreadEvent[] {
  return events.map((event) => ({ ...event }));
}

export function normalizeStoredThreadEvents(input: {
  threadEvents?: ThreadEvent[] | null;
}): ThreadEvent[] {
  return serializeThreadEvents(input.threadEvents || []);
}

export function classifyThreadEvent(event: { kind?: ThreadEventKind; title?: string; message?: string }): ThreadEventKind {
  if (event.kind) return event.kind;
  const haystack = `${event.title || ""} ${event.message || ""}`;
  if (/patch|diff|file edit/i.test(haystack)) return "patchProposal";
  if (/command|terminal/i.test(haystack)) return "commandExecution";
  if (/approval|permission/i.test(haystack)) return "approvalRequest";
  if (/question/i.test(haystack)) return "question";
  if (/error|failed/i.test(haystack)) return "error";
  return "agentMessage";
}
