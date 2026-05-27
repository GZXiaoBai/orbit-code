import type { ModelCapability, ReasoningEffort } from "../domain/types";

export type CapabilityCatalogMatch = Partial<Pick<
  ModelCapability,
  "maxContextTokens" | "maxOutputTokens" | "reasoningLevels" | "toolCalls" | "streaming" | "buildSupported"
>> & {
  capabilitySource: ModelCapability["capabilitySource"];
};

const catalogEntries: Array<{
  providerId?: string;
  pattern: RegExp;
  capability: CapabilityCatalogMatch;
}> = [
  {
    providerId: "deepseek",
    pattern: /deepseek-v4-(flash|pro)/i,
    capability: {
      maxContextTokens: 1_000_000,
      maxOutputTokens: 384_000,
      reasoningLevels: ["auto", "balanced", "high", "max"],
      toolCalls: true,
      streaming: true,
      buildSupported: true,
      capabilitySource: "officialTable",
    },
  },
  {
    providerId: "deepseek",
    pattern: /deepseek-reasoner/i,
    capability: {
      maxContextTokens: 128_000,
      maxOutputTokens: 64_000,
      reasoningLevels: ["balanced", "deep"],
      toolCalls: true,
      streaming: true,
      buildSupported: true,
      capabilitySource: "officialTable",
    },
  },
  {
    providerId: "deepseek",
    pattern: /deepseek-chat/i,
    capability: {
      maxContextTokens: 128_000,
      maxOutputTokens: 8_000,
      reasoningLevels: ["fast", "balanced"],
      toolCalls: true,
      streaming: true,
      buildSupported: true,
      capabilitySource: "officialTable",
    },
  },
  {
    providerId: "openai",
    pattern: /gpt-5/i,
    capability: {
      maxContextTokens: 400_000,
      reasoningLevels: ["auto", "fast", "balanced", "deep"],
      toolCalls: true,
      streaming: true,
      buildSupported: true,
      capabilitySource: "officialTable",
    },
  },
  {
    providerId: "anthropic",
    pattern: /claude/i,
    capability: {
      maxContextTokens: 200_000,
      reasoningLevels: ["auto", "balanced", "deep"],
      toolCalls: true,
      streaming: true,
      buildSupported: true,
      capabilitySource: "officialTable",
    },
  },
  {
    providerId: "google",
    pattern: /gemini-2\.5/i,
    capability: {
      maxContextTokens: 1_000_000,
      reasoningLevels: ["auto", "fast", "balanced", "deep"],
      toolCalls: true,
      streaming: true,
      buildSupported: true,
      capabilitySource: "officialTable",
    },
  },
  {
    providerId: "ollama",
    pattern: /.*/i,
    capability: {
      buildSupported: false,
      capabilitySource: "officialTable",
    },
  },
];

export function capabilityFromOfficialCatalog(providerId: string, model: string): CapabilityCatalogMatch | null {
  return catalogEntries.find((entry) =>
    (!entry.providerId || entry.providerId === providerId) && entry.pattern.test(model)
  )?.capability ?? null;
}

export function inferReasoningLevelsFromModel(providerId: string, model: string): ReasoningEffort[] {
  const key = `${providerId} ${model}`.toLowerCase();

  if (!model) return ["auto"];
  if (providerId === "fixture") return ["auto", "balanced"];
  if (/(reasoner|thinking|o1|o3|o4|gpt-5|opus|pro|max)/.test(key)) {
    return ["balanced", "deep"];
  }
  if (/(flash|mini|haiku|nano|small|lite|turbo)/.test(key)) {
    return ["fast", "balanced"];
  }
  return ["fast", "balanced", "deep"];
}
