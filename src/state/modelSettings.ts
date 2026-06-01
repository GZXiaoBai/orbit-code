import type { ModelCapability, ModelProviderConfig, ReasoningEffort } from "../domain/types";
import type { CodexSidecarStatus, ProviderBuildGate } from "../domain/codex";
import { findProvider, providerRegistry } from "../providers/providerRegistry";
import { fallbackCapability, isOpenAICompatibleProvider } from "../providers/providerAdapters";
import { capabilityFromOfficialCatalog, inferReasoningLevelsFromModel } from "../providers/modelCapabilityCatalog";
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

export function buildRunModelOptions(
  settings: ProviderSettings,
  apiKeys: Record<string, string> = {},
  savedCredentialProviders: string[] = [],
): RunModelOption[] {
  const savedCredentialSet = new Set(savedCredentialProviders);
  return providerRegistry.flatMap((provider) => {
    const config = normalizeProviderConfig(provider, settings.configs[provider.id]);
    const hasImportedModelState = config.importedModels.length > 0 || config.customModels.length > 0 || config.enabledModels.length > 0;
    if (!provider.capabilities.local && !apiKeys[provider.id] && !savedCredentialSet.has(provider.id) && !hasImportedModelState) return [];
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
  savedCredentialProviders: string[] = [],
): RunModelOption | null {
  const options = buildRunModelOptions(settings, apiKeys, savedCredentialProviders);
  if (options.length === 0) return null;

  const activeProviderMatch = options.find((option) => option.providerId === settings.activeProviderId);
  if (preferred?.providerId === "fixture" && settings.activeProviderId && settings.activeProviderId !== "fixture" && activeProviderMatch) {
    return activeProviderMatch;
  }

  const preferredMatch = options.find((option) =>
    option.providerId === preferred?.providerId && option.model === preferred?.model
  );
  if (preferredMatch) return preferredMatch;

  const preferredProviderMatch = options.find((option) => option.providerId === preferred?.providerId);
  if (preferredProviderMatch) return preferredProviderMatch;

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
  const official = capabilityFromOfficialCatalog(providerId, model);
  const adapterFallback = fallbackCapability(providerId, model);
  const bridgeBuildSupported = providerId === "deepseek" || providerId === "fixture";
  const buildSupported = (official?.buildSupported ?? adapterFallback.buildSupported) && bridgeBuildSupported;
  return {
    streaming: official?.streaming ?? provider.capabilities.streaming,
    reasoningLevels: official?.reasoningLevels || adapterFallback.reasoningLevels || inferReasoningEfforts(providerId, model),
    toolCalls: official?.toolCalls ?? provider.capabilities.toolCalls,
    local: provider.capabilities.local,
    buildSupported: buildSupported && (
      provider.capabilities.toolCalls
      || isOpenAICompatibleProvider(providerId)
      || providerId === "fixture"
    ),
    maxContextTokens: official?.maxContextTokens || adapterFallback.maxContextTokens || provider.capabilities.maxContextTokens,
    maxOutputTokens: official?.maxOutputTokens || adapterFallback.maxOutputTokens,
    capabilitySource: official?.capabilitySource || adapterFallback.capabilitySource,
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
  return inferReasoningLevelsFromModel(providerId, model);
}

export function buildProviderBuildGate(input: {
  providerId: string;
  model: string;
  settings: ProviderSettings;
  apiKeys?: Record<string, string>;
  savedCredentialProviders?: string[];
  sidecarStatus?: CodexSidecarStatus | null;
}): ProviderBuildGate {
  const provider = findProvider(input.providerId);
  const config = provider ? getProviderConfig(input.settings, provider.id) : null;
  const capability = input.model && provider ? inferModelCapability(provider.id, input.model) : undefined;
  const hasUnlockedKey = Boolean(input.apiKeys?.[input.providerId]);
  const hasSavedKey = Boolean(input.savedCredentialProviders?.includes(input.providerId));
  const hasModel = Boolean(input.model && config && [...config.importedModels, ...config.customModels, ...config.enabledModels].includes(input.model));

  if (!provider) {
    return {
      providerId: input.providerId,
      model: input.model,
      canBuild: false,
      canStream: false,
      bridgeStatus: "blocked",
      blockedReason: "Unknown provider.",
    };
  }
  if (!provider.capabilities.local && !hasUnlockedKey) {
    return {
      providerId: provider.id,
      model: input.model,
      canBuild: false,
      canStream: Boolean(capability?.streaming),
      bridgeStatus: hasSavedKey ? "vaultLocked" : "blocked",
      blockedReason: hasSavedKey
        ? "Credential is saved but the Orbit vault is locked."
        : "API key is not unlocked in the Orbit credential vault.",
    };
  }
  if (!hasModel) {
    return {
      providerId: provider.id,
      model: input.model,
      canBuild: false,
      canStream: Boolean(capability?.streaming),
      bridgeStatus: "discovery",
      blockedReason: "Import or enable a model before using Build.",
    };
  }
  if (!capability?.buildSupported) {
    return {
      providerId: provider.id,
      model: input.model,
      canBuild: false,
      canStream: Boolean(capability?.streaming),
      bridgeStatus: "blocked",
      blockedReason: provider.id === "deepseek"
        ? "This DeepSeek model is missing verified Build capabilities."
        : provider.id === "ollama"
          ? "Ollama 当前仅接入模型发现，Build 尚未接入 Codex Responses bridge。"
        : "Build is blocked until this provider's Responses bridge adapter is verified.",
    };
  }
  const smoke = input.settings.smokeStatus?.[provider.id];
  if (provider.id === "deepseek" && smoke?.status !== "smokePassed") {
    return {
      providerId: provider.id,
      model: input.model,
      canBuild: false,
      canStream: Boolean(capability.streaming),
      bridgeStatus: "smokeFailed",
      blockedReason: smoke?.status === "smokeFailed"
        ? smoke.message || "DeepSeek bridge smoke failed."
        : "Run the Codex bridge smoke before enabling Build.",
    };
  }
  if (input.sidecarStatus && !input.sidecarStatus.running) {
    return {
      providerId: provider.id,
      model: input.model,
      canBuild: false,
      canStream: capability.streaming,
      bridgeStatus: "blocked",
      blockedReason: input.sidecarStatus.lastError
        ? `Codex sidecar is not ready: ${input.sidecarStatus.lastError}`
        : "Codex sidecar is not ready. Restart the Codex runtime before using Build.",
    };
  }
  return {
    providerId: provider.id,
    model: input.model,
    canBuild: true,
    canStream: capability.streaming,
    bridgeStatus: "ready",
  };
}
