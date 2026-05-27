import type { AgentEvent, AgentEventPatch } from "./agentEvents";

export type ThreadEventKind =
  | "userMessage"
  | "agentMessage"
  | "reasoningSummary"
  | "plan"
  | "agentSummary"
  | "commandBegin"
  | "commandEnd"
  | "commandExecution"
  | "approvalRequest"
  | "approvalResult"
  | "patchProposal"
  | "question"
  | "verification"
  | "finalSummary"
  | "contextCompaction";

export interface ThreadEvent {
  id: string;
  kind: ThreadEventKind;
  workspacePath?: string;
  threadId?: string;
  taskId?: string;
  runSessionId?: string;
  role: AgentEvent["role"];
  status: AgentEvent["status"];
  title: string;
  message: string;
  timestamp: string;
  createdAt?: string;
  patches?: AgentEventPatch[];
  sourceEvent?: AgentEvent;
}

export function classifyThreadEvent(event: AgentEvent): ThreadEventKind {
  const haystack = `${event.name} ${event.message}`;
  if (event.patches?.length) return "patchProposal";
  if (/^User Instruction$/i.test(event.name)) return "userMessage";
  if (/^Final Summary$/i.test(event.name)) return "finalSummary";
  if (/Plan Ready|计划/i.test(haystack)) return "plan";
  if (/Question|询问|问题/i.test(event.name)) return "question";
  if (/Verification|验证/i.test(haystack)) return "verification";
  if (/Recovered Waiting State|Waiting For Continue|Continue Agent|等待继续|继续执行/i.test(haystack)) return "commandExecution";
  if (/Approval Gate|请求审批|等待.*批准|waiting.*approval/i.test(haystack)) return "approvalRequest";
  if (/Approval Granted|Approval Denied|已批准|已拒绝|approved|denied/i.test(haystack)) return "approvalResult";
  if (/Executing:\s*run_command|正在处理：命令/i.test(haystack)) return "commandBegin";
  if (/Tool run_command result|terminal result|命令.*结果/i.test(haystack)) return "commandEnd";
  if (/run_command|命令|审批/i.test(haystack)) return "commandExecution";
  if (/compact|compress|压缩上下文/i.test(haystack)) return "contextCompaction";
  if (/reasoning|思考|推理/i.test(haystack)) return "reasoningSummary";
  return event.role === "planner" || event.role === "coder" || event.role === "reviewer" || event.role === "verifier"
    ? "agentMessage"
    : "agentSummary";
}

export function agentEventToThreadEvent(event: AgentEvent): ThreadEvent {
  return {
    id: event.id,
    kind: classifyThreadEvent(event),
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
      kind: event.kind || classifyThreadEvent(threadEventToAgentEvent(event)),
      title: event.title || threadEventToAgentEvent(event).name,
      message: event.message || threadEventToAgentEvent(event).message,
      timestamp: event.timestamp || threadEventToAgentEvent(event).timestamp,
    }));
  }
  return buildThreadEvents(input.agentEvents || []);
}
