import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/tauri";

export const ORBIT_CODE_VAULT_PREFIX = "credential.vault.";

export const credentialVaultStorage = {
  async saveApiKey(providerId: string, apiKey: string, passphrase: string): Promise<void> {
    if (!isTauri()) {
      console.warn(`[CredentialVault] Non-Tauri environment: API Key for "${providerId}" will NOT be persisted.`);
      return;
    }
    await invoke("store_vault_credential", {
      provider: providerId,
      secret: apiKey,
      passphrase,
    });
  },

  async unlock(passphrase: string): Promise<string[]> {
    if (!isTauri()) return [];
    return invoke<string[]>("unlock_credential_vault", { passphrase });
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
