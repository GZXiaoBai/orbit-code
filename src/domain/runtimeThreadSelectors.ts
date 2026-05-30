import type { ActionRequiredEvent } from "./actionRequired";
import type { RuntimeMessage, RuntimeMessagePart } from "./runtimeMessages";
import type { ThinkingDisplayPreference } from "./types";
import type { ToolCallLifecycle } from "./toolCallLifecycle";

export interface RuntimeToolSummary {
  id: string;
  name: string;
  summary: string;
  status: string;
}

export interface RuntimeThreadMessageView {
  id: string;
  role: RuntimeMessage["role"];
  status: RuntimeMessage["status"];
  parts: RuntimeMessagePart[];
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeThreadViewModel {
  messages: RuntimeThreadMessageView[];
  pendingActions: ActionRequiredEvent[];
  activeThinkingVisibility: ThinkingDisplayPreference;
  safeToolSummaries: RuntimeToolSummary[];
  finishState: "idle" | "streaming" | "completed" | "failed" | "cancelled";
}

export function selectRuntimeThread(
  messages: RuntimeMessage[],
  actions: ActionRequiredEvent[] = [],
  toolCalls: ToolCallLifecycle[] = [],
  thinkingPreference: ThinkingDisplayPreference = "expanded",
): RuntimeThreadViewModel {
  const visibleMessages = messages.map((message) => {
    const finished = message.status !== "streaming" || message.parts.some((part) => part.type === "finish");
    return {
      id: message.id,
      role: message.role,
      status: message.status,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      parts: message.parts
        .filter((part) => thinkingPreference !== "hidden" || (part.type !== "thinking" && part.type !== "reasoning"))
        .map((part) => normalizeRuntimePart(part, thinkingPreference, finished)),
    };
  });

  return {
    messages: visibleMessages,
    pendingActions: actions.filter((action) => action.status === "pending"),
    activeThinkingVisibility: thinkingPreference,
    safeToolSummaries: toolCalls.map((call) => ({
      id: call.id,
      name: call.tool,
      summary: call.argsSummary || call.tool,
      status: call.status,
    })),
    finishState: finishStateForMessages(messages),
  };
}

function normalizeRuntimePart(
  part: RuntimeMessagePart,
  preference: ThinkingDisplayPreference,
  messageFinished: boolean,
): RuntimeMessagePart {
  if (part.type !== "thinking" && part.type !== "reasoning") return { ...part };
  const text = part.type === "reasoning" ? part.text : part.text;
  return {
    type: "thinking",
    text,
    collapsed: preference === "collapsed" || messageFinished,
  };
}

function finishStateForMessages(messages: RuntimeMessage[]): RuntimeThreadViewModel["finishState"] {
  const last = [...messages].reverse().find((message) => message.role === "assistant");
  if (!last) return "idle";
  if (last.status === "streaming") return "streaming";
  if (last.status === "failed") return "failed";
  if (last.status === "cancelled") return "cancelled";
  return "completed";
}
