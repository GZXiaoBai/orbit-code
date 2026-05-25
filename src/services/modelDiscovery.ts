import { invoke } from "@tauri-apps/api/core";
import { providerRegistry } from "../providers/providerRegistry";
import { isTauri } from "../utils/tauri";

function fallbackModels(providerId: string): string[] {
  return providerRegistry.find((provider) => provider.id === providerId)?.recommendedModels || [];
}

export async function discoverProviderModels(providerId: string, baseUrl?: string): Promise<string[]> {
  if (providerId === "fixture") {
    return fallbackModels(providerId);
  }

  if (!isTauri()) {
    return fallbackModels(providerId);
  }

  const models = await invoke<string[]>("list_llm_models", {
    provider: providerId,
    baseUrl: baseUrl?.trim() || null,
  });

  const normalized = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : fallbackModels(providerId);
}
