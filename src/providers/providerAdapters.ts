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
  if (/moonshot-v1-128k|kimi|qwen.*max|glm-4\.5|glm-4\.6|glm-5/.test(key)) return 128_000;
  if (/gpt-5|grok-4|mistral-large|mistral-medium|codestral|devstral|siliconflow/.test(key)) return 256_000;
  if (/claude|qwen|groq|mistral|xai/.test(key)) return 128_000;
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

export function normalizeModelInfo(providerId: string, raw: unknown): ImportedModelInfo | null {
  const id = readModelId(raw).trim();
  if (!id) return null;
  const capability = fallbackCapability(providerId, id);
  if (raw && typeof raw === "object") {
    const item = raw as Record<string, any>;
    const maxContext = item.context_length || item.max_context_length || item.input_token_limit;
    const toolCalls = item.supported_parameters?.includes?.("tools")
      ?? item.capabilities?.function_calling
      ?? capability.toolCalls;
    return {
      id,
      label: typeof item.name === "string" && item.name !== id ? item.name : undefined,
      raw,
      capability: {
        ...capability,
        maxContextTokens: typeof maxContext === "number" ? maxContext : capability.maxContextTokens,
        toolCalls: Boolean(toolCalls),
        capabilitySource: typeof maxContext === "number" ? "api" : capability.capabilitySource,
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
