import type { ModelCapability, ModelProviderConfig, ReasoningEffort } from "../domain/types";
import { findProvider, providerRegistry } from "../providers/providerRegistry";
import { fallbackCapability, isOpenAICompatibleProvider } from "../providers/providerAdapters";
import type { ProviderConfig, ProviderSettings } from "./useSession";

export interface RunModelOption {
  id: string;
  providerId: string;
  providerLabel: string;
  model: string;
  label: string;
  source: "recommended" | "custom" | "default";
  capability?: ModelCapability;
}

const modelContextByPattern: Array<{ providerId?: string; pattern: RegExp; maxContextTokens: number; maxOutputTokens?: number; reasoningLevels?: ReasoningEffort[] }> = [
  { providerId: "deepseek", pattern: /deepseek-v4-(flash|pro)/i, maxContextTokens: 1_000_000, maxOutputTokens: 384_000, reasoningLevels: ["auto", "balanced", "high", "max"] },
  { providerId: "deepseek", pattern: /deepseek-reasoner/i, maxContextTokens: 128_000, maxOutputTokens: 64_000, reasoningLevels: ["balanced", "deep"] },
  { providerId: "deepseek", pattern: /deepseek-chat/i, maxContextTokens: 128_000, maxOutputTokens: 8_000, reasoningLevels: ["fast", "balanced"] },
  { providerId: "openai", pattern: /gpt-5/i, maxContextTokens: 400_000, reasoningLevels: ["auto", "fast", "balanced", "deep"] },
  { providerId: "anthropic", pattern: /claude/i, maxContextTokens: 200_000, reasoningLevels: ["auto", "balanced", "deep"] },
  { providerId: "google", pattern: /gemini-2\.5/i, maxContextTokens: 1_000_000, reasoningLevels: ["auto", "fast", "balanced", "deep"] },
];

export type NormalizedProviderConfig = Required<Pick<ProviderConfig, "enabledModels" | "customModels" | "importedModels" | "modelCapabilities">> & ProviderConfig;

function uniqueModels(models: Array<string | undefined>): string[] {
  return [...new Set(models.map((model) => model?.trim()).filter(Boolean) as string[])];
}

export function normalizeProviderConfig(
  provider: ModelProviderConfig,
  config: ProviderConfig | undefined,
): NormalizedProviderConfig {
  const importedModels = uniqueModels(config?.importedModels || []);
  const customModels = uniqueModels(config?.customModels || []);
  const rawCapabilities = config?.modelCapabilities || {};
  const modelPool = uniqueModels([...importedModels, ...customModels, config?.defaultModel]);
  const modelCapabilities = Object.fromEntries(
    modelPool.map((model) => {
      const inferred = inferModelCapability(provider.id, model);
      return [model, { ...inferred, ...(rawCapabilities[model] || {}) }];
    })
  );
  const enabledModels = Array.isArray(config?.enabledModels)
    ? uniqueModels(config?.enabledModels)
    : uniqueModels([config?.defaultModel].filter((model) => importedModels.includes(model || "")));

  return {
    ...config,
    importedModels,
    enabledModels,
    customModels,
    modelCapabilities,
  };
}

export function getProviderConfig(settings: ProviderSettings, providerId: string): NormalizedProviderConfig {
  const provider = findProvider(providerId) || providerRegistry[0];
  return normalizeProviderConfig(provider, settings.configs[providerId]);
}

export function buildRunModelOptions(settings: ProviderSettings, apiKeys: Record<string, string> = {}): RunModelOption[] {
  return providerRegistry.flatMap((provider) => {
    if (!provider.capabilities.local && !apiKeys[provider.id]) return [];
    const config = normalizeProviderConfig(provider, settings.configs[provider.id]);
    const modelPool = uniqueModels([...config.importedModels, ...config.customModels]);
    const enabledModels = config.enabledModels.filter((model) => modelPool.includes(model));
    return enabledModels.map((model) => ({
      id: `${provider.id}:${model}`,
      providerId: provider.id,
      providerLabel: provider.label,
      model,
      label: `${provider.label} · ${model}`,
      source: config.customModels.includes(model)
        ? "custom"
        : provider.recommendedModels.includes(model)
          ? "recommended"
          : "default",
      capability: config.modelCapabilities[model],
    }));
  });
}

export function resolveModelSelection(
  settings: ProviderSettings,
  apiKeys: Record<string, string> = {},
  preferred?: { providerId?: string; model?: string },
): RunModelOption | null {
  const options = buildRunModelOptions(settings, apiKeys);
  if (options.length === 0) return null;

  const preferredMatch = options.find((option) =>
    option.providerId === preferred?.providerId && option.model === preferred?.model
  );
  if (preferredMatch) return preferredMatch;

  const preferredProviderMatch = options.find((option) => option.providerId === preferred?.providerId);
  if (preferredProviderMatch) return preferredProviderMatch;

  const activeProviderMatch = options.find((option) => option.providerId === settings.activeProviderId);
  return activeProviderMatch || options[0];
}

export function setModelEnabled(
  settings: ProviderSettings,
  providerId: string,
  model: string,
  enabled: boolean,
): ProviderSettings {
  const provider = findProvider(providerId);
  if (!provider) return settings;

  const current = normalizeProviderConfig(provider, settings.configs[providerId]);
  const modelPool = uniqueModels([...current.importedModels, ...current.customModels, model]);
  const enabledModels = enabled
    ? uniqueModels([...current.enabledModels, model])
    : current.enabledModels.filter((item) => item !== model);

  const cleanedEnabledModels = enabledModels.filter((item) => modelPool.includes(item));
  const defaultModel = cleanedEnabledModels.includes(current.defaultModel || "")
    ? current.defaultModel
    : cleanedEnabledModels[0] || "";

  return {
    ...settings,
    activeProviderId: enabled ? providerId : settings.activeProviderId,
    configs: {
      ...settings.configs,
      [providerId]: {
        ...current,
        defaultModel,
        importedModels: modelPool.filter((item) => current.importedModels.includes(item) || item === model),
        enabledModels: cleanedEnabledModels,
        modelCapabilities: current.modelCapabilities,
      },
    },
  };
}

export function inferModelCapability(providerId: string, model: string): ModelCapability {
  const provider = findProvider(providerId) || providerRegistry[0];
  const tableMatch = modelContextByPattern.find((entry) =>
    (!entry.providerId || entry.providerId === providerId) && entry.pattern.test(model)
  );
  const adapterFallback = fallbackCapability(providerId, model);
  return {
    streaming: provider.capabilities.streaming,
    reasoningLevels: tableMatch?.reasoningLevels || adapterFallback.reasoningLevels || inferReasoningEfforts(providerId, model),
    toolCalls: provider.capabilities.toolCalls,
    local: provider.capabilities.local,
    buildSupported: providerId === "fixture" || providerId === "anthropic" || providerId === "google" || isOpenAICompatibleProvider(providerId),
    maxContextTokens: tableMatch?.maxContextTokens || adapterFallback.maxContextTokens || provider.capabilities.maxContextTokens,
    maxOutputTokens: tableMatch?.maxOutputTokens || adapterFallback.maxOutputTokens,
    capabilitySource: tableMatch ? "officialTable" : adapterFallback.capabilitySource,
  };
}

export function setImportedModels(settings: ProviderSettings, providerId: string, models: string[]): ProviderSettings {
  const provider = findProvider(providerId);
  if (!provider) return settings;

  const current = normalizeProviderConfig(provider, settings.configs[providerId]);
  const importedModels = uniqueModels(models);
  const modelPool = uniqueModels([...importedModels, ...current.customModels]);
  const existingEnabled = current.enabledModels.filter((model) => modelPool.includes(model));
  const enabledModels = existingEnabled.length > 0 ? existingEnabled : modelPool;
  const modelCapabilities = Object.fromEntries(
    modelPool.map((model) => [model, current.modelCapabilities[model] || inferModelCapability(providerId, model)])
  );

  return {
    ...settings,
    activeProviderId: providerId,
    configs: {
      ...settings.configs,
      [providerId]: {
        ...current,
        importedModels,
        enabledModels,
        defaultModel: enabledModels[0] || "",
        modelCapabilities,
      },
    },
  };
}

export function addCustomModel(settings: ProviderSettings, providerId: string, model: string): ProviderSettings {
  const provider = findProvider(providerId);
  const cleanModel = model.trim();
  if (!provider || !cleanModel) return settings;

  const current = normalizeProviderConfig(provider, settings.configs[providerId]);
  return {
    ...settings,
    activeProviderId: providerId,
    configs: {
      ...settings.configs,
      [providerId]: {
        ...current,
        defaultModel: current.defaultModel || cleanModel,
        customModels: uniqueModels([...current.customModels, cleanModel]),
        enabledModels: uniqueModels([...current.enabledModels, cleanModel]),
        modelCapabilities: current.modelCapabilities,
      },
    },
  };
}

export function inferReasoningEfforts(providerId: string, model: string): ReasoningEffort[] {
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
