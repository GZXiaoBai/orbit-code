import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context as PiContext,
  Model,
  Tool as PiTool,
} from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolCall, ToolName, ToolParams } from "../domain/agentLoop";
import type { RuntimeMessagePart } from "../domain/runtimeMessages";

export type PiNormalizedStreamEvent =
  | { type: "thinking_start"; contentIndex?: number }
  | { type: "thinking_delta"; contentIndex?: number; delta: string }
  | { type: "thinking_end"; contentIndex?: number; delta?: string }
  | { type: "text_delta"; contentIndex?: number; delta: string }
  | { type: "toolcall_start"; contentIndex?: number; toolCallId: string; toolName: string }
  | { type: "toolcall_delta"; contentIndex?: number; toolCallId: string; toolName: string; partialArgs?: Record<string, unknown>; delta?: string }
  | { type: "toolcall_end"; contentIndex?: number; toolCallId: string; toolName: string; finalArgs?: Record<string, unknown> }
  | { type: "done"; reason: "stop" | "tool_use" | "cancelled" | "error"; message?: unknown }
  | { type: "error"; error: string };

export interface PiModelCapability {
  modelId: string;
  provider: string;
  supportsTools: boolean;
  supportsThinking: boolean;
  contextWindow?: number;
  maxTokens?: number;
  sdkSource: "pi-ai" | "fallback";
}

export interface PiToolValidationResult {
  ok: boolean;
  toolCall?: ToolCall;
  toolResult?: string;
  error?: string;
}

export interface PiSdkAdapter {
  normalizeModel(modelId: string, provider: string): PiModelCapability;
  stream(input: { model: Model<any>; context: PiContext; options?: Record<string, unknown> }): AsyncIterable<PiNormalizedStreamEvent>;
  validateToolCall(toolCall: unknown, tools: Array<PiTool | AgentTool<any>>): PiToolValidationResult;
  toRuntimeMessagePart(event: PiNormalizedStreamEvent): RuntimeMessagePart | null;
}

export function createPiSdkAdapter(): PiSdkAdapter {
  return new DefaultPiSdkAdapter();
}

class DefaultPiSdkAdapter implements PiSdkAdapter {
  normalizeModel(modelId: string, provider: string): PiModelCapability {
    return {
      modelId,
      provider,
      supportsTools: true,
      supportsThinking: /deepseek|reason|think|claude|gemini|gpt-5|qwen|kimi/i.test(`${provider} ${modelId}`),
      sdkSource: "fallback",
    };
  }

  async *stream(input: { model: Model<any>; context: PiContext; options?: Record<string, unknown> }): AsyncIterable<PiNormalizedStreamEvent> {
    const piAi = await loadPiAi();
    const stream = piAi.streamSimple(input.model, input.context, input.options as any);
    for await (const event of stream as AsyncIterable<AssistantMessageEvent>) {
      for (const normalized of normalizeAssistantMessageEvent(event)) yield normalized;
    }
  }

  validateToolCall(toolCall: unknown, tools: Array<PiTool | AgentTool<any>>): PiToolValidationResult {
    const raw = toolCall as { id?: unknown; name?: unknown; arguments?: unknown; params?: unknown };
    const name = typeof raw?.name === "string" ? raw.name : "";
    const id = typeof raw?.id === "string" ? raw.id : `pi-tool-${Date.now()}`;
    const schema = tools.find((tool) => tool.name === name);
    if (!name || !schema) {
      return {
        ok: false,
        toolResult: `Tool validation failed: unknown tool ${name || "(missing)"}.`,
        error: "unknown_tool",
      };
    }
    const params = normalizeToolParams(raw.arguments ?? raw.params);
    if (!params) {
      return {
        ok: false,
        toolResult: `Tool validation failed for ${name}: arguments must be an object.`,
        error: "invalid_arguments",
      };
    }
    return {
      ok: true,
      toolCall: {
        id,
        name: name as ToolName,
        params,
        status: "pending",
      },
    };
  }

  toRuntimeMessagePart(event: PiNormalizedStreamEvent): RuntimeMessagePart | null {
    if (event.type === "thinking_delta" || event.type === "thinking_end") {
      return event.delta ? { type: "thinking", text: event.delta } : null;
    }
    if (event.type === "text_delta") return { type: "text", text: event.delta };
    if (event.type === "toolcall_start" || event.type === "toolcall_delta" || event.type === "toolcall_end") {
      return {
        type: "toolCall",
        id: event.toolCallId,
        name: event.toolName,
        argsSummary: summarizeToolArgs(event.type === "toolcall_end" ? event.finalArgs : event.type === "toolcall_delta" ? event.partialArgs : undefined),
        finished: event.type === "toolcall_end",
      };
    }
    if (event.type === "done") return { type: "finish", reason: event.reason, at: new Date().toISOString() };
    if (event.type === "error") return { type: "error", message: event.error, recoverable: true };
    return null;
  }
}

function normalizeAssistantMessageEvent(event: AssistantMessageEvent): PiNormalizedStreamEvent[] {
  if (event.type === "thinking_delta") return [{ type: "thinking_delta", contentIndex: event.contentIndex, delta: event.delta }];
  if (event.type === "thinking_end") return [{ type: "thinking_end", contentIndex: event.contentIndex, delta: event.content }];
  if (event.type === "text_delta") return [{ type: "text_delta", contentIndex: event.contentIndex, delta: event.delta }];
  if (event.type === "toolcall_delta") {
    const toolCall = event.partial.content[event.contentIndex];
    return toolCall?.type === "toolCall"
      ? [{ type: "toolcall_delta", contentIndex: event.contentIndex, toolCallId: toolCall.id, toolName: toolCall.name, partialArgs: toolCall.arguments }]
      : [];
  }
  if (event.type === "toolcall_end") {
    return [{ type: "toolcall_end", contentIndex: event.contentIndex, toolCallId: event.toolCall.id, toolName: event.toolCall.name, finalArgs: event.toolCall.arguments }];
  }
  if (event.type === "done") return [{ type: "done", reason: stopReason(event.message) }];
  if (event.type === "error") return [{ type: "error", error: event.error.errorMessage || "Pi stream failed." }];
  return [];
}

function stopReason(message: AssistantMessage): Extract<PiNormalizedStreamEvent, { type: "done" }>["reason"] {
  if (message.stopReason === "toolUse") return "tool_use";
  if (message.stopReason === "aborted") return "cancelled";
  if (message.stopReason === "error") return "error";
  return "stop";
}

function normalizeToolParams(value: unknown): ToolParams | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as ToolParams;
}

function summarizeToolArgs(args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return "Preparing tool arguments";
  const keys = Object.keys(args).slice(0, 4);
  return `Arguments: ${keys.join(", ")}${Object.keys(args).length > keys.length ? ", ..." : ""}`;
}

async function loadPiAi(): Promise<typeof import("@earendil-works/pi-ai")> {
  const loader = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("@earendil-works/pi-ai")>;
  return loader("@earendil-works/pi-ai");
}
