import type { ToolName, ToolParams } from "./agentLoop";
import { createThreadEvent, type ThreadEvent } from "./threadEvents";

export type RuntimeMessageRole = "system" | "user" | "assistant" | "tool";
export type RuntimeMessageStatus = "streaming" | "completed" | "failed" | "cancelled";

export type RuntimeMessagePart =
  | { type: "thinking"; text: string; collapsed?: boolean }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "toolCall"; id: string; name: ToolName | string; argsSummary: string; params?: ToolParams; finished?: boolean }
  | { type: "toolResult"; toolCallId: string; name?: ToolName | string; content: string; isError?: boolean; metadata?: string }
  | { type: "finish"; reason: "stop" | "tool_use" | "cancelled" | "error" | "permission_denied"; at: string }
  | { type: "error"; message: string; code?: string; recoverable?: boolean };

export interface RuntimeMessage {
  id: string;
  threadId: string;
  role: RuntimeMessageRole;
  parts: RuntimeMessagePart[];
  status: RuntimeMessageStatus;
  parentId?: string | null;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeMessageSnapshot {
  messages?: RuntimeMessage[] | null;
}

export function createRuntimeMessage(input: {
  id?: string;
  threadId: string;
  role: RuntimeMessageRole;
  parts?: RuntimeMessagePart[];
  status?: RuntimeMessageStatus;
  parentId?: string | null;
  model?: string;
  at?: string;
}): RuntimeMessage {
  const at = input.at || new Date().toISOString();
  return {
    id: input.id || `message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    threadId: input.threadId,
    role: input.role,
    parts: serializeRuntimeMessageParts(input.parts || []),
    status: input.status || "streaming",
    parentId: input.parentId,
    model: input.model,
    createdAt: at,
    updatedAt: at,
  };
}

export function appendRuntimeMessagePart(
  message: RuntimeMessage,
  part: RuntimeMessagePart,
  at = new Date().toISOString(),
): RuntimeMessage {
  return {
    ...message,
    parts: serializeRuntimeMessageParts([...message.parts, part]),
    updatedAt: at,
  };
}

export function finishRuntimeMessage(
  message: RuntimeMessage,
  reason: Extract<RuntimeMessagePart, { type: "finish" }>["reason"] = "stop",
  at = new Date().toISOString(),
): RuntimeMessage {
  const withoutFinish = message.parts.filter((part) => part.type !== "finish");
  return {
    ...message,
    parts: serializeRuntimeMessageParts([...withoutFinish, { type: "finish", reason, at }]),
    status: reason === "cancelled" ? "cancelled" : reason === "error" ? "failed" : "completed",
    updatedAt: at,
  };
}

export function serializeRuntimeMessages(messages: RuntimeMessage[] = []): RuntimeMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: serializeRuntimeMessageParts(message.parts),
  }));
}

export function restoreRuntimeMessages(snapshot?: RuntimeMessageSnapshot | null): RuntimeMessage[] {
  return serializeRuntimeMessages(snapshot?.messages || []);
}

export function runtimeMessageText(message: RuntimeMessage): string {
  return message.parts
    .filter((part): part is Extract<RuntimeMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function runtimeMessageReasoning(message: RuntimeMessage): string {
  return message.parts
    .filter((part): part is Extract<RuntimeMessagePart, { type: "reasoning" | "thinking" }> => part.type === "reasoning" || part.type === "thinking")
    .map((part) => part.text)
    .join("");
}

export const runtimeMessageThinking = runtimeMessageReasoning;

export function runtimeMessagesToThreadEvents(messages: RuntimeMessage[]): ThreadEvent[] {
  return messages.flatMap((message) => {
    const events: ThreadEvent[] = [];
    const text = runtimeMessageText(message);
    const reasoning = runtimeMessageReasoning(message);
    const error = message.parts.find((part): part is Extract<RuntimeMessagePart, { type: "error" }> => part.type === "error");
    if (reasoning) {
      events.push(createThreadEvent({
        id: `${message.id}:reasoning`,
        kind: "reasoningSummary",
        threadId: message.threadId,
        role: "planner",
        title: "Agent Reasoning",
        status: message.status === "streaming" ? "thinking" : "done",
        message: reasoning,
        timestamp: message.updatedAt,
      }));
    }
    if (error) {
      events.push(createThreadEvent({
        id: `${message.id}:error`,
        kind: "error",
        threadId: message.threadId,
        role: "planner",
        title: "Agent Error",
        status: error.recoverable ? "idle" : "done",
        message: error.message,
        timestamp: message.updatedAt,
      }));
    }
    if (text) {
      events.push(createThreadEvent({
        id: `${message.id}:text`,
        kind: message.role === "user" ? "userMessage" : "agentMessage",
        threadId: message.threadId,
        role: "planner",
        title: message.role === "user" ? "User Message" : "Agent Message",
        status: message.status === "streaming" ? "thinking" : "done",
        message: text,
        timestamp: message.updatedAt,
      }));
    }
    for (const part of message.parts) {
      if (part.type !== "toolCall") continue;
      events.push(createThreadEvent({
        id: `${message.id}:tool:${part.id}`,
        kind: "toolCall",
        threadId: message.threadId,
        role: "planner",
        title: "Tool Call",
        status: part.finished ? "done" : "thinking",
        message: `${part.name}: ${part.argsSummary}`,
        timestamp: message.updatedAt,
        toolCall: {
          id: part.id,
          name: String(part.name),
          status: part.finished ? "done" : "pending",
        },
      }));
    }
    return events;
  });
}

function serializeRuntimeMessageParts(parts: RuntimeMessagePart[]): RuntimeMessagePart[] {
  return parts.map((part) => ({ ...part }));
}

export type PiRuntimeMessageRole = RuntimeMessageRole;
export type PiRuntimeMessageStatus = RuntimeMessageStatus;
export type PiRuntimeMessagePart = RuntimeMessagePart;
export type PiRuntimeMessage = RuntimeMessage;
export type PiRuntimeMessageSnapshot = RuntimeMessageSnapshot;

export const createPiRuntimeMessage = createRuntimeMessage;
export const appendPiRuntimeMessagePart = appendRuntimeMessagePart;
export const finishPiRuntimeMessage = finishRuntimeMessage;
export const restorePiRuntimeMessages = restoreRuntimeMessages;
export const piRuntimeMessagesToThreadEvents = runtimeMessagesToThreadEvents;
