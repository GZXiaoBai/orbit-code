import type { AgentEvent } from "./agentEvents";
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

export type ThreadEvent = ThreadEventProtocol & {
  sourceEvent?: AgentEvent;
};

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

export function classifyLegacyAgentEvent(event: AgentEvent): ThreadEventKind {
  const haystack = `${event.name} ${event.message}`;
  if (event.question) return "question";
  if (event.planDraft) return "planDraft";
  if (event.patches?.length) return "patchProposal";
  if (/^User Instruction$/i.test(event.name)) return "userMessage";
  if (/^Final Summary$/i.test(event.name)) return "finalSummary";
  if (/^Mode Switch$/i.test(event.name)) return "modeSwitch";
  if (/^Tool Denied By Mode$/i.test(event.name)) return "toolDeniedByMode";
  if (/Plan Draft|计划草案/i.test(event.name)) return "planDraft";
  if (/Plan Ready|计划/i.test(haystack)) return "plan";
  if (/Question|询问|问题/i.test(event.name)) return "question";
  if (/Verification|验证/i.test(haystack)) return "verification";
  if (/Recovered Waiting State|Waiting For Continue|Continue Agent|等待继续|继续执行/i.test(haystack)) return "commandExecution";
  if (/Approval Gate|请求审批|等待.*批准|waiting.*approval/i.test(haystack)) return "approvalRequest";
  if (/Approval Granted|Approval Denied|已批准|已拒绝|approved|denied/i.test(haystack)) return "approvalResult";
  if (/Executing:\s*run_command|正在处理：命令/i.test(haystack)) return "commandBegin";
  if (/Tool run_command result|terminal result|命令.*结果/i.test(haystack)) return "commandEnd";
  if (/Agent Error|error/i.test(event.name)) return "error";
  if (/run_command|命令|审批/i.test(haystack)) return "commandExecution";
  if (/compact|compress|压缩上下文/i.test(haystack)) return "contextCompaction";
  if (/reasoning|思考|推理/i.test(haystack)) return "reasoningSummary";
  return event.role === "planner" || event.role === "coder" || event.role === "reviewer" || event.role === "verifier"
    ? "agentMessage"
    : "agentSummary";
}

export const classifyThreadEvent = classifyLegacyAgentEvent;

export function agentEventToThreadEvent(event: AgentEvent): ThreadEvent {
  return {
    id: event.id,
    kind: classifyLegacyAgentEvent(event),
    workspacePath: event.workspacePath,
    threadId: event.threadId,
    taskId: event.taskId,
    runSessionId: event.runSessionId,
    role: event.role,
    status: event.status,
    title: event.name,
    message: event.message,
    timestamp: event.timestamp,
    createdAt: event.createdAt,
    patches: event.patches,
    question: event.question,
    planDraft: event.planDraft,
    sourceEvent: event,
  };
}

export function buildThreadEvents(events: AgentEvent[]): ThreadEvent[] {
  return events.map(agentEventToThreadEvent);
}

export function serializeThreadEvents(events: ThreadEvent[]): ThreadEvent[] {
  return events.map(({ sourceEvent: _sourceEvent, ...event }) => event);
}

export function threadEventToAgentEvent(event: ThreadEvent): AgentEvent {
  return event.sourceEvent ? {
    ...event.sourceEvent,
    workspacePath: event.workspacePath ?? event.sourceEvent.workspacePath,
    threadId: event.threadId ?? event.sourceEvent.threadId,
    taskId: event.taskId ?? event.sourceEvent.taskId,
    runSessionId: event.runSessionId ?? event.sourceEvent.runSessionId,
  } : {
    id: event.id,
    workspacePath: event.workspacePath,
    threadId: event.threadId,
    taskId: event.taskId,
    runSessionId: event.runSessionId,
    role: event.role,
    name: event.title,
    status: event.status,
    message: event.message,
    timestamp: event.timestamp,
    createdAt: event.createdAt,
    patches: event.patches,
    question: event.question,
    planDraft: event.planDraft,
  };
}

export function buildAgentEventsFromThreadEvents(events: ThreadEvent[]): AgentEvent[] {
  return events.map(threadEventToAgentEvent);
}

export function normalizeStoredThreadEvents(input: {
  threadEvents?: ThreadEvent[] | null;
  agentEvents?: AgentEvent[] | null;
}): ThreadEvent[] {
  if (input.threadEvents && input.threadEvents.length > 0) {
    return input.threadEvents.map((event) => ({
      ...event,
      kind: event.kind || classifyLegacyAgentEvent(threadEventToAgentEvent(event)),
      title: event.title || threadEventToAgentEvent(event).name,
      message: event.message || threadEventToAgentEvent(event).message,
      timestamp: event.timestamp || threadEventToAgentEvent(event).timestamp,
      question: event.question,
      planDraft: event.planDraft,
    }));
  }
  return buildThreadEvents(input.agentEvents || []);
}
