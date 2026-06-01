import { invoke } from "@tauri-apps/api/core";
import { providerRegistry } from "../providers/providerRegistry";
import { isTauri } from "../utils/tauri";

function fallbackModels(providerId: string): string[] {
  return providerRegistry.find((provider) => provider.id === providerId)?.recommendedModels || [];
}

function sanitizeProviderError(providerId: string, message: string): string {
  if (providerId === "deepseek" && /api key/i.test(message) && /invalid|authentication|unauthorized/i.test(message)) {
    return "DeepSeek API Key 无效或不属于当前接口。请重新粘贴 DeepSeek 控制台生成的 API Key。";
  }
  return message.replace(/api key:\s*\*+[A-Za-z0-9_-]+/gi, "api key is hidden");
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
  }).catch((error) => {
    throw new Error(sanitizeProviderError(providerId, error instanceof Error ? error.message : String(error)));
  });

  const normalized = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : fallbackModels(providerId);
}
