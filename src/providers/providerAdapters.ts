import type { ImportedModelInfo, ModelCapability, ReasoningEffort } from "../domain/types";
import { providerRegistry } from "./providerRegistry";

export interface ProviderAdapter {
  id: string;
  chatPath: string;
  modelsPath: string;
  responseKind: "openai" | "anthropic" | "google";
  streaming: boolean;
  normalizeModel: (raw: unknown) => ImportedModelInfo | null;
  capabilityFallback: (modelId: string) => ModelCapability;
}

const openAICompatibleIds = new Set([
  "openai",
  "deepseek",
  "openrouter",
  "xai",
  "mistral",
  "groq",
  "qwen",
  "kimi",
  "siliconflow",
  "zhipu",
  "together",
  "fireworks",
  "cerebras",
  "nvidia",
  "azure-openai",
  "custom-openai",
]);

export function isOpenAICompatibleProvider(providerId: string): boolean {
  return openAICompatibleIds.has(providerId);
}

export function providerChatPath(providerId: string): string {
  if (providerId === "anthropic") return "/messages";
  if (providerId === "google") return "";
  return "/chat/completions";
}

export function providerModelsPath(providerId: string): string {
  if (providerId === "ollama") return "/api/tags";
  return "/models";
}

export function appendProviderPath(baseUrl: string, path: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!path) return clean;
  for (const suffix of ["/chat/completions", "/responses", "/messages", "/api/chat", "/api/tags", "/models"]) {
    if (clean.endsWith(suffix)) return `${clean.slice(0, -suffix.length)}${path}`;
  }
  if (clean.endsWith(path)) return clean;
  return `${clean}${path}`;
}

function providerDefaults(providerId: string) {
  return providerRegistry.find((provider) => provider.id === providerId)?.capabilities;
}

function reasoningFromModel(providerId: string, modelId: string): ReasoningEffort[] {
  const key = `${providerId} ${modelId}`.toLowerCase();
  if (/(thinking|reason|r1|o1|o3|o4|gpt-5|grok-4|magistral|glm-4\.5|glm-4\.6|glm-5|k2|max)/.test(key)) {
    return ["auto", "balanced", "deep", "high"];
  }
  if (/(flash|mini|small|lite|turbo|instant|fast)/.test(key)) {
    return ["auto", "fast", "balanced"];
  }
  return ["auto", "fast", "balanced", "deep"];
}

function contextFallback(providerId: string, modelId: string): number {
  const key = `${providerId} ${modelId}`.toLowerCase();
  if (/deepseek-v4|v4-pro|v4-flash|gemini-2\.5|openrouter/.test(key)) return 1_000_000;
  if (/azure-openai|gpt-5|gpt-4\.1/.test(key)) return 400_000;
  if (/moonshot-v1-128k|kimi|qwen.*max|glm-4\.5|glm-4\.6|glm-5/.test(key)) return 128_000;
  if (/cerebras/.test(key)) return 131_072;
  if (/fireworks|nvidia/.test(key)) return 262_144;
  if (/gpt-5|grok-4|mistral-large|mistral-medium|codestral|devstral|siliconflow/.test(key)) return 256_000;
  if (/claude|qwen|groq|mistral|xai|together/.test(key)) return 128_000;
  return providerDefaults(providerId)?.maxContextTokens || 64_000;
}

export function fallbackCapability(providerId: string, modelId: string): ModelCapability {
  const defaults = providerDefaults(providerId);
  return {
    streaming: defaults?.streaming ?? true,
    reasoningLevels: reasoningFromModel(providerId, modelId),
    toolCalls: defaults?.toolCalls ?? isOpenAICompatibleProvider(providerId),
    local: defaults?.local ?? false,
    buildSupported: providerId !== "ollama",
    maxContextTokens: contextFallback(providerId, modelId),
    capabilitySource: "officialTable",
  };
}

function readModelId(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  const item = raw as Record<string, unknown>;
  return String(item.id || item.name || item.model || "").replace(/^models\//, "");
}

function readNumber(raw: Record<string, any>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/_/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

function readNestedNumber(raw: Record<string, any>, paths: string[][]): number | undefined {
  for (const path of paths) {
    let current: any = raw;
    for (const key of path) current = current?.[key];
    if (typeof current === "number" && Number.isFinite(current) && current > 0) return current;
    if (typeof current === "string") {
      const parsed = Number(current.replace(/_/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

function readBoolean(raw: Record<string, any>, paths: string[][]): boolean | undefined {
  for (const path of paths) {
    let current: any = raw;
    for (const key of path) current = current?.[key];
    if (typeof current === "boolean") return current;
  }
  return undefined;
}

function arrayContains(raw: Record<string, any>, keys: string[], needles: string[]): boolean | undefined {
  for (const key of keys) {
    const values = raw[key];
    if (!Array.isArray(values)) continue;
    return values.some((value) => {
      const text = String(value).toLowerCase();
      return needles.some((needle) => text.includes(needle));
    });
  }
  return undefined;
}

export function normalizeModelInfo(providerId: string, raw: unknown): ImportedModelInfo | null {
  const id = readModelId(raw).trim();
  if (!id) return null;
  const capability = fallbackCapability(providerId, id);
  if (raw && typeof raw === "object") {
    const item = raw as Record<string, any>;
    const maxContext = readNumber(item, [
      "maxContextTokens",
      "max_context_tokens",
      "context_length",
      "contextLength",
      "max_context_length",
      "maxContextLength",
      "context_window",
      "contextWindow",
      "input_token_limit",
      "inputTokenLimit",
      "max_input_tokens",
      "maxInputTokens",
    ]) ?? readNestedNumber(item, [["capabilities", "context_length"], ["limits", "context_window"]]);
    const maxOutput = readNumber(item, [
      "maxOutputTokens",
      "max_output_tokens",
      "max_completion_tokens",
      "maxCompletionTokens",
      "output_token_limit",
      "outputTokenLimit",
    ]) ?? readNestedNumber(item, [
      ["capabilities", "max_output_tokens"],
      ["limits", "output_tokens"],
      ["limits", "max_completion_tokens"],
      ["limits", "maxCompletionTokens"],
    ]);
    const toolCalls = readBoolean(item, [
      ["toolCalls"],
      ["tool_calls"],
      ["supportsTools"],
      ["supports_tools"],
      ["capabilities", "tools"],
      ["capabilities", "toolCalls"],
      ["capabilities", "tool_calls"],
      ["capabilities", "function_calling"],
    ]) ?? arrayContains(item, ["supported_parameters", "supportedParameters", "features"], ["tools", "tool_choice", "function"]);
    const apiDerived = typeof maxContext === "number"
      || typeof maxOutput === "number"
      || typeof toolCalls === "boolean";
    return {
      id,
      label: typeof item.label === "string" && item.label !== id
        ? item.label
        : typeof item.displayName === "string" && item.displayName !== id
          ? item.displayName
          : typeof item.display_name === "string" && item.display_name !== id
            ? item.display_name
            : typeof item.name === "string" && item.name !== id ? item.name : undefined,
      raw,
      capability: {
        ...capability,
        maxContextTokens: typeof maxContext === "number" ? maxContext : capability.maxContextTokens,
        maxOutputTokens: typeof maxOutput === "number" ? maxOutput : capability.maxOutputTokens,
        toolCalls: typeof toolCalls === "boolean" ? toolCalls : capability.toolCalls,
        capabilitySource: apiDerived ? "api" : capability.capabilitySource,
      },
    };
  }
  return { id, capability };
}

export function getProviderAdapter(providerId: string): ProviderAdapter {
  return {
    id: providerId,
    chatPath: providerChatPath(providerId),
    modelsPath: providerModelsPath(providerId),
    responseKind: providerId === "anthropic" ? "anthropic" : providerId === "google" ? "google" : "openai",
    streaming: providerDefaults(providerId)?.streaming ?? true,
    normalizeModel: (raw) => normalizeModelInfo(providerId, raw),
    capabilityFallback: (modelId) => fallbackCapability(providerId, modelId),
  };
}
