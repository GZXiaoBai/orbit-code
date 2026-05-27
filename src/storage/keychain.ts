import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/tauri";

export const ORBIT_CODE_VAULT_PREFIX = "credential.vault.";

export const credentialVaultStorage = {
  async saveApiKey(providerId: string, apiKey: string, passphrase: string, rememberDevice = false): Promise<void> {
    if (!isTauri()) {
      console.warn(`[CredentialVault] Non-Tauri environment: API Key for "${providerId}" will NOT be persisted.`);
      return;
    }
    await invoke("store_vault_credential", {
      provider: providerId,
      secret: apiKey,
      passphrase,
      rememberDevice,
    });
  },

  async unlock(passphrase: string): Promise<string[]> {
    if (!isTauri()) return [];
    return invoke<string[]>("unlock_credential_vault", { passphrase });
  },

  async enableAutoUnlock(passphrase: string): Promise<string[]> {
    if (!isTauri()) return [];
    return invoke<string[]>("enable_vault_auto_unlock", { passphrase });
  },

  async tryAutoUnlock(): Promise<string[]> {
    if (!isTauri()) return [];
    return invoke<string[]>("try_vault_auto_unlock");
  },

  async disableAutoUnlock(): Promise<void> {
    if (!isTauri()) return;
    await invoke("disable_vault_auto_unlock");
  },

  async isAutoUnlockEnabled(): Promise<boolean> {
    if (!isTauri()) return false;
    return invoke<boolean>("is_vault_auto_unlock_enabled");
  },

  async listSavedProviders(): Promise<string[]> {
    if (!isTauri()) return [];
    return invoke<string[]>("list_vault_credential_providers");
  },

  async deleteApiKey(providerId: string): Promise<void> {
    if (!isTauri()) return;
    await invoke("delete_vault_credential", { provider: providerId });
  },
};

// Backward-compatible import name while the surrounding state module is being
// split up. This no longer uses OS Keychain.
export const keychainStorage = credentialVaultStorage;
