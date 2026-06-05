import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AdvancedSettings,
  AcceptedBuildPlan,
  AgentSettings,
  CodingPlan,
  ContextSettings,
  GeneralSettings,
  ModelCapability,
  PlanTask,
  ProjectSecurityOverride,
  ProviderSmokeRecord,
  SandboxMode,
  SecuritySettings,
} from "../domain/types";
import type { LLMProvider } from "../services/llmService";
import { parseCodingPlan } from "../domain/planSchema";
import { findProvider } from "../providers/providerRegistry";
import { sessionStore } from "../storage/sessionStore";
import { isTauri } from "../utils/tauri";
import { resolveModelSelection } from "./modelSettings";

export interface ImportedPlanState {
  plan: CodingPlan;
  fileName: string;
  importedAt: string;
}

export interface ImportErrorState {
  fileName?: string;
  errors: string[];
}

export interface ProviderConfig {
  baseUrl?: string;
  defaultModel?: string;
  importedModels?: string[];
  enabledModels?: string[];
  customModels?: string[];
  modelCapabilities?: Record<string, ModelCapability>;
}

export interface ProviderSettings {
  activeProviderId: string;
  configs: Record<string, ProviderConfig>;
  sandboxMode?: SandboxMode;
  security?: SecuritySettings;
  projectSecurityOverrides?: Record<string, ProjectSecurityOverride>;
  agent?: AgentSettings;
  general?: GeneralSettings;
  advanced?: AdvancedSettings;
  context?: ContextSettings;
  smokeStatus?: Record<string, ProviderSmokeRecord>;
}

export interface SessionState {
  isLoading: boolean;
  importedPlan: ImportedPlanState | null;
  importError: ImportErrorState | null;
  providerSettings: ProviderSettings;
  acceptedPlansByThreadId: Record<string, AcceptedBuildPlan | null>;
  apiKeys: Record<string, string>;
  credentialVaultProviders: string[];
  credentialVaultAutoUnlock: boolean;
  isRealLLMActive: boolean;
  activeLLMConfig: { provider: LLMProvider; model: string; url?: string } | null;
  activeTitle: string | null;
  outputFiles: string[];
  importPlan: (source: string, fileName?: string) => Promise<boolean>;
  restoreImportedPlan: (plan: ImportedPlanState | null) => void;
  updateAcceptedPlan: (threadId: string, plan: AcceptedBuildPlan | null) => void;
  clearImportedPlan: () => void;
  updateTask: (taskId: string, updates: Partial<PlanTask>) => void;
  addTask: (task: PlanTask) => void;
  deleteTask: (taskId: string) => void;
  moveTask: (taskId: string, direction: "up" | "down") => void;
  updateProviderSettings: (newSettings: ProviderSettings) => Promise<void>;
  updateApiKey: (providerId: string, key: string, passphrase: string, rememberDevice?: boolean) => Promise<void>;
  unlockCredentialVault: (passphrase: string, rememberDevice?: boolean) => Promise<string[]>;
  disableCredentialVaultAutoUnlock: () => Promise<void>;
}

const defaultProviderSettings: ProviderSettings = {
  activeProviderId: "openai",
  configs: {},
  sandboxMode: "none",
  security: {
    preset: "askBeforeAction",
    advancedRules: {},
    sandboxMode: "none",
  },
  projectSecurityOverrides: {},
  agent: {
    maxIterations: 15,
    contextBudget: "balanced",
    autoCompact: true,
    autoSelfHeal: false,
    verificationApproval: true,
    fixtureProviderEnabled: false,
  },
  general: {
    startMode: "plan",
    openLastWorkspace: true,
  },
  advanced: {
    diagnosticsEnabled: false,
  },
  context: {
    userRules: [],
  },
  smokeStatus: {},
};

export function normalizeProviderSettings(settings: ProviderSettings | null | undefined): ProviderSettings {
  const security = settings?.security || defaultProviderSettings.security!;
  return {
    ...defaultProviderSettings,
    ...settings,
    configs: settings?.configs || {},
    sandboxMode: security.sandboxMode || settings?.sandboxMode || "none",
    security: {
      preset: security.preset || "askBeforeAction",
      advancedRules: security.advancedRules || {},
      sandboxMode: security.sandboxMode || settings?.sandboxMode || "none",
    },
    projectSecurityOverrides: settings?.projectSecurityOverrides || {},
    agent: { ...defaultProviderSettings.agent!, ...(settings?.agent || {}) },
    general: { ...defaultProviderSettings.general!, ...(settings?.general || {}) },
    advanced: { ...defaultProviderSettings.advanced!, ...(settings?.advanced || {}) },
    context: {
      ...defaultProviderSettings.context!,
      ...(settings?.context || {}),
      userRules: (settings?.context?.userRules || []).map((rule, index) => ({
        id: rule.id || `user-rule-${index}`,
        title: rule.title || `User rule ${index + 1}`,
        content: rule.content || "",
        enabled: rule.enabled !== false,
        mode: rule.mode === "plan" || rule.mode === "build" || rule.mode === "both" ? rule.mode : "both",
        source: "user" as const,
        globs: rule.globs,
        regex: rule.regex,
        policy: rule.policy,
      })),
    },
    smokeStatus: settings?.smokeStatus || {},
  };
}

export function useSession(): SessionState {
  const [isLoading, setIsLoading] = useState(true);
  const [importedPlan, setImportedPlan] = useState<ImportedPlanState | null>(null);
  const [importError, setImportError] = useState<ImportErrorState | null>(null);
  const [acceptedPlansByThreadId, setAcceptedPlansByThreadId] = useState<Record<string, AcceptedBuildPlan | null>>({});
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => normalizeProviderSettings(defaultProviderSettings));
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [credentialVaultProviders, setCredentialVaultProviders] = useState<string[]>([]);
  const [credentialVaultAutoUnlock, setCredentialVaultAutoUnlock] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        sessionStore.clearLegacySession();
        const session = await sessionStore.loadSession();
        const storedConfigs = await sessionStore.loadProviderConfigs();
        if (session?.importedPlan) setImportedPlan(session.importedPlan);
        setAcceptedPlansByThreadId(session?.acceptedPlansByThreadId || {});
        const storedSettings = session?.providerSettings as ProviderSettings | undefined;
        setProviderSettings(normalizeProviderSettings({
          activeProviderId: storedSettings?.activeProviderId || defaultProviderSettings.activeProviderId,
          ...storedSettings,
          configs: {
            ...(storedSettings?.configs || {}),
            ...storedConfigs,
          },
        }));
        if (isTauri()) {
          const providers = await invoke<string[]>("list_vault_credential_providers").catch(() => []);
          setCredentialVaultProviders(providers);
          const autoUnlock = await invoke<boolean>("is_vault_auto_unlock_enabled").catch(() => false);
          setCredentialVaultAutoUnlock(Boolean(autoUnlock));
          if (autoUnlock) {
            const unlockedProviders = await invoke<string[]>("try_vault_auto_unlock").catch(() => []);
            setApiKeys(Object.fromEntries(unlockedProviders.map((provider) => [provider, "vault"])));
          } else {
            setApiKeys({});
          }
        }
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    void sessionStore.saveSession({
      schemaVersion: "codex-sidecar.v1",
      importedPlan,
      acceptedPlansByThreadId,
      providerSettings: providerSettings as any,
      lastActiveAt: new Date().toISOString(),
    });
  }, [acceptedPlansByThreadId, importedPlan, isLoading, providerSettings]);

  const activeSelection = useMemo(() => resolveModelSelection(providerSettings, apiKeys, {
    providerId: providerSettings.activeProviderId,
  }, credentialVaultProviders), [apiKeys, credentialVaultProviders, providerSettings]);
  const activeProvider = activeSelection?.providerId ? findProvider(activeSelection.providerId) : null;
  const isRealLLMActive = Boolean(activeProvider && (activeProvider.capabilities.local || apiKeys[activeProvider.id] || credentialVaultProviders.includes(activeProvider.id)));
  const activeLLMConfig = activeProvider && activeSelection ? {
    provider: activeProvider.id as LLMProvider,
    model: activeSelection.model,
    url: providerSettings.configs[activeProvider.id]?.baseUrl,
  } : null;

  const importPlan = useCallback(async (source: string, fileName = "coding-plan.yaml") => {
    const result = parseCodingPlan(source);
    if (!result.ok) {
      setImportError({ fileName, errors: result.errors });
      return false;
    }
    const planState = { plan: result.plan, fileName, importedAt: new Date().toISOString() };
    setImportedPlan(planState);
    setImportError(null);
    await sessionStore.savePlan(result.plan, fileName);
    return true;
  }, []);

  const restoreImportedPlan = useCallback((plan: ImportedPlanState | null) => {
    setImportedPlan(plan);
    setImportError(null);
  }, []);

  const updateAcceptedPlan = useCallback((threadId: string, plan: AcceptedBuildPlan | null) => {
    setAcceptedPlansByThreadId((prev) => {
      const next = { ...prev };
      if (plan) {
        next[threadId] = plan;
      } else {
        delete next[threadId];
      }
      return next;
    });
  }, []);

  const clearImportedPlan = useCallback(() => {
    setImportedPlan(null);
    setImportError(null);
  }, []);

  const updateTask = useCallback((taskId: string, updates: Partial<PlanTask>) => {
    setImportedPlan((prev) => prev ? {
      ...prev,
      plan: {
        ...prev.plan,
        tasks: prev.plan.tasks.map((task) => task.id === taskId ? { ...task, ...updates } : task),
      },
    } : prev);
  }, []);

  const addTask = useCallback((task: PlanTask) => {
    setImportedPlan((prev) => prev ? { ...prev, plan: { ...prev.plan, tasks: [...prev.plan.tasks, task] } } : prev);
  }, []);

  const deleteTask = useCallback((taskId: string) => {
    setImportedPlan((prev) => prev ? { ...prev, plan: { ...prev.plan, tasks: prev.plan.tasks.filter((task) => task.id !== taskId) } } : prev);
  }, []);

  const moveTask = useCallback((taskId: string, direction: "up" | "down") => {
    setImportedPlan((prev) => {
      if (!prev) return prev;
      const tasks = [...prev.plan.tasks];
      const index = tasks.findIndex((task) => task.id === taskId);
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || nextIndex < 0 || nextIndex >= tasks.length) return prev;
      [tasks[index], tasks[nextIndex]] = [tasks[nextIndex], tasks[index]];
      return { ...prev, plan: { ...prev.plan, tasks } };
    });
  }, []);

  const updateProviderSettings = useCallback(async (newSettings: ProviderSettings) => {
    const normalized = normalizeProviderSettings(newSettings);
    setProviderSettings(normalized);
    await sessionStore.saveProviderConfigs(normalized.configs);
  }, []);

  const updateApiKey = useCallback(async (providerId: string, key: string, passphrase: string, rememberDevice = false) => {
    if (isTauri()) {
      await invoke("store_vault_credential", { provider: providerId, secret: key, passphrase, rememberDevice });
      const providers = await invoke<string[]>("list_vault_credential_providers").catch(() => [providerId]);
      setCredentialVaultProviders(providers);
      setApiKeys(Object.fromEntries(providers.map((provider) => [provider, "vault"])));
      return;
    }
    setApiKeys((prev) => ({ ...prev, [providerId]: key }));
  }, []);

  const unlockCredentialVault = useCallback(async (passphrase: string, rememberDevice = false) => {
    if (!isTauri()) return Object.keys(apiKeys);
    const providers = rememberDevice
      ? await invoke<string[]>("enable_vault_auto_unlock", { passphrase })
      : await invoke<string[]>("unlock_credential_vault", { passphrase });
    setCredentialVaultProviders(providers);
    setCredentialVaultAutoUnlock(rememberDevice);
    setApiKeys(Object.fromEntries(providers.map((provider) => [provider, "vault"])));
    return providers;
  }, [apiKeys]);

  const disableCredentialVaultAutoUnlock = useCallback(async () => {
    if (isTauri()) await invoke("disable_vault_auto_unlock");
    setCredentialVaultAutoUnlock(false);
  }, []);

  return {
    isLoading,
    importedPlan,
    importError,
    providerSettings,
    acceptedPlansByThreadId,
    apiKeys,
    credentialVaultProviders,
    credentialVaultAutoUnlock,
    isRealLLMActive,
    activeLLMConfig,
    activeTitle: importedPlan?.plan.title || null,
    outputFiles: [],
    importPlan,
    restoreImportedPlan,
    updateAcceptedPlan,
    clearImportedPlan,
    updateTask,
    addTask,
    deleteTask,
    moveTask,
    updateProviderSettings,
    updateApiKey,
    unlockCredentialVault,
    disableCredentialVaultAutoUnlock,
  };
}
