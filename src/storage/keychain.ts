import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/tauri";

export const ORBIT_CODE_KEYCHAIN_SERVICE = "orbit-code";
export const LEGACY_AGENT_GUI_KEYCHAIN_SERVICE = "agent-gui";
export const KEYCHAIN_SERVICE_CANDIDATES = [
  ORBIT_CODE_KEYCHAIN_SERVICE,
  LEGACY_AGENT_GUI_KEYCHAIN_SERVICE,
] as const;

export const keychainStorage = {
  /**
   * 安全地将敏感的 API Key 存入系统 Keychain
   */
  async saveApiKey(providerId: string, apiKey: string): Promise<void> {
    if (!isTauri()) {
      // 非桌面环境不落地存储
      console.warn(`[Keychain] Non-Tauri environment: API Key for "${providerId}" will NOT be persisted.`);
      return;
    }
    try {
      await invoke("store_credential", {
        service: ORBIT_CODE_KEYCHAIN_SERVICE,
        account: providerId,
        secret: apiKey,
      });
      invoke("store_credential", {
        service: LEGACY_AGENT_GUI_KEYCHAIN_SERVICE,
        account: providerId,
        secret: apiKey,
      }).catch(() => {
        // Best-effort backward compatibility for older desktop bundles.
      });
    } catch (e) {
      console.error(`[Keychain] Failed to save key for "${providerId}" to system keychain:`, e);
      throw e;
    }
  },

  /**
   * 从系统 Keychain 中安全获取 API Key
   */
  async loadApiKey(providerId: string): Promise<string | null> {
    if (!isTauri()) {
      return null;
    }
    try {
      for (const service of KEYCHAIN_SERVICE_CANDIDATES) {
        const key = await invoke<string | null>("get_credential", {
          service,
          account: providerId,
        });
        if (key) {
          if (service === LEGACY_AGENT_GUI_KEYCHAIN_SERVICE) {
            await invoke("store_credential", {
              service: ORBIT_CODE_KEYCHAIN_SERVICE,
              account: providerId,
              secret: key,
            }).catch(() => {
              // Read compatibility matters more than migration success.
            });
          }
          return key;
        }
      }
      return null;
    } catch (e) {
      console.error(`[Keychain] Failed to load key for "${providerId}" from system keychain:`, e);
      return null;
    }
  }
};
