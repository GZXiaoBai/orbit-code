import { invoke } from "@tauri-apps/api/core";
import type { ImportedModelInfo } from "../domain/types";
import { normalizeModelInfo } from "../providers/providerAdapters";
import { providerRegistry } from "../providers/providerRegistry";
import { isTauri } from "../utils/tauri";

export type DiscoveredProviderModel = string | ImportedModelInfo;

function fallbackModels(providerId: string): string[] {
  return providerRegistry.find((provider) => provider.id === providerId)?.recommendedModels || [];
}

function sanitizeProviderError(providerId: string, message: string): string {
  if (providerId === "deepseek" && /api key/i.test(message) && /invalid|authentication|unauthorized/i.test(message)) {
    return "DeepSeek API Key 无效或不属于当前接口。请重新粘贴 DeepSeek 控制台生成的 API Key。";
  }
  return message.replace(/api key:\s*\*+[A-Za-z0-9_-]+/gi, "api key is hidden");
}

function normalizeDiscoveredModels(providerId: string, models: unknown[]): ImportedModelInfo[] {
  const byId = new Map<string, ImportedModelInfo>();
  for (const model of models) {
    const normalized = normalizeModelInfo(providerId, model);
    if (normalized) byId.set(normalized.id, normalized);
  }
  return [...byId.values()];
}

function isMissingStructuredDiscoveryCommand(message: string): boolean {
  return /list_llm_model_infos|command.*not.*found|unknown.*command/i.test(message);
}

export async function discoverProviderModels(providerId: string, baseUrl?: string): Promise<DiscoveredProviderModel[]> {
  if (providerId === "fixture") {
    return fallbackModels(providerId);
  }

  if (!isTauri()) {
    return fallbackModels(providerId);
  }

  const request = {
    provider: providerId,
    baseUrl: baseUrl?.trim() || null,
  };

  const structured = await invoke<unknown[]>("list_llm_model_infos", request).catch((error) => {
    const message = sanitizeProviderError(providerId, error instanceof Error ? error.message : String(error));
    if (isMissingStructuredDiscoveryCommand(message)) return null;
    throw new Error(message);
  });
  if (structured) {
    const normalized = normalizeDiscoveredModels(providerId, structured);
    if (normalized.length > 0) return normalized;
  }

  const models = await invoke<string[]>("list_llm_models", request).catch((error) => {
    throw new Error(sanitizeProviderError(providerId, error instanceof Error ? error.message : String(error)));
  });

  const normalized = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : fallbackModels(providerId);
}
