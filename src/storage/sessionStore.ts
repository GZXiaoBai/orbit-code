import { invoke } from "@tauri-apps/api/core";
import type { CodexThread } from "../domain/codex";
import type { CodingPlan, ProviderSmokeRecord } from "../domain/types";
import type { ModelCapability } from "../domain/types";
import { isTauri } from "../utils/tauri";

interface StoredProviderConfig {
  baseUrl?: string;
  defaultModel?: string;
  importedModels?: string[];
  enabledModels?: string[];
  customModels?: string[];
  modelCapabilities?: Record<string, ModelCapability>;
}

export interface StoredImportedPlan {
  plan: CodingPlan;
  fileName: string;
  importedAt: string;
}

export interface CodexSessionState {
  schemaVersion: "codex-sidecar.v1";
  importedPlan: StoredImportedPlan | null;
  providerSettings: {
    activeProviderId: string;
    configs: Record<string, StoredProviderConfig>;
    sandboxMode?: string;
    smokeStatus?: Record<string, ProviderSmokeRecord>;
    [key: string]: unknown;
  };
  activeCodexThread?: CodexThread | null;
  lastActiveAt: string;
}

const SESSION_KEY = "session:codex-sidecar:current";
const WEB_SESSION_KEY = "orbit-code.codex-sidecar.session";
const LEGACY_WEB_SESSION_KEY = "agent-gui.session";

function parseCodexSession(raw: string | null): CodexSessionState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CodexSessionState>;
    return parsed.schemaVersion === "codex-sidecar.v1" ? parsed as CodexSessionState : null;
  } catch {
    return null;
  }
}

export const sessionStore = {
  async saveSession(session: CodexSessionState): Promise<void> {
    const value = JSON.stringify(session);
    if (!isTauri()) {
      localStorage.setItem(WEB_SESSION_KEY, value);
      return;
    }
    try {
      await invoke("save_session_state", { key: SESSION_KEY, value });
    } catch (e) {
      console.warn("[SessionStore] Save failed, falling back to localStorage", e);
      localStorage.setItem(WEB_SESSION_KEY, value);
    }
  },

  async loadSession(): Promise<CodexSessionState | null> {
    if (!isTauri()) {
      return parseCodexSession(localStorage.getItem(WEB_SESSION_KEY));
    }
    try {
      const raw = await invoke<string | null>("load_session_state", { key: SESSION_KEY });
      const session = parseCodexSession(raw);
      if (session) return session;
    } catch (e) {
      console.warn("[SessionStore] Load failed, trying localStorage fallback", e);
    }
    return parseCodexSession(localStorage.getItem(WEB_SESSION_KEY));
  },

  clearLegacySession(): void {
    try {
      localStorage.removeItem(LEGACY_WEB_SESSION_KEY);
    } catch {
      // Legacy cleanup is best effort.
    }
  },

  async savePlan(plan: CodingPlan, fileName: string): Promise<void> {
    if (!isTauri()) {
      localStorage.setItem("orbit-code.codex-sidecar.plan", JSON.stringify({ plan, fileName }));
      return;
    }
    try {
      const planId = `plan-${Date.now()}`;
      await invoke("save_plan", {
        id: planId,
        threadId: "codex-sidecar",
        title: plan.title,
        goals: JSON.stringify(plan.goals),
        constraints: JSON.stringify(plan.constraints),
        acceptanceCriteria: JSON.stringify(plan.acceptanceCriteria),
        risks: JSON.stringify(plan.risks),
        referencesJson: JSON.stringify(plan.references),
        rawYaml: JSON.stringify(plan),
      });
      await invoke("save_plan_tasks", {
        planId,
        tasksJson: JSON.stringify(plan.tasks),
      });
    } catch (e) {
      console.warn("[SessionStore] Save plan failed", e);
    }
  },

  async loadProviderConfigs(): Promise<Record<string, StoredProviderConfig>> {
    if (!isTauri()) return {};
    try {
      const configs = await invoke<any[]>("list_provider_configs");
      const result: Record<string, StoredProviderConfig> = {};
      for (const cfg of configs) {
        const rawConfig = cfg.config_json ? JSON.parse(cfg.config_json) : {};
        result[cfg.provider] = {
          baseUrl: cfg.base_url || undefined,
          defaultModel: cfg.default_model || undefined,
          importedModels: rawConfig.importedModels || [],
          enabledModels: rawConfig.enabledModels || [],
          customModels: rawConfig.customModels || [],
          modelCapabilities: rawConfig.modelCapabilities || {},
        };
      }
      return result;
    } catch (e) {
      console.warn("[SessionStore] Load provider configs failed", e);
      return {};
    }
  },

  async saveProviderConfigs(configs: Record<string, StoredProviderConfig>): Promise<void> {
    if (!isTauri()) return;
    try {
      for (const [providerId, cfg] of Object.entries(configs)) {
        await invoke("save_provider_config", {
          id: `cfg-${providerId}`,
          provider: providerId,
          label: providerId,
          apiKeyProviderId: providerId,
          baseUrl: cfg.baseUrl || "",
          defaultModel: cfg.defaultModel || "",
          capabilities: "{}",
          configJson: JSON.stringify(cfg),
        });
      }
    } catch (e) {
      console.warn("[SessionStore] Save provider configs failed", e);
    }
  },
};
