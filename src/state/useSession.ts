import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AdvancedSettings,
  AgentSettings,
  CodingPlan,
  ContextSettings,
  GeneralSettings,
  ModelCapability,
  ProviderSmokeRecord,
  PlanTask,
  ProjectSecurityOverride,
  SandboxMode,
  SecuritySettings,
} from "../domain/types";
import type { LLMProvider } from "../services/llmService";
import type { AgentRunSession } from "../domain/agentRunSession";
import type { QuestionRequest } from "../domain/questionRequest";
import type { ActionRequiredEvent } from "../domain/actionRequired";
import type { TerminalRun } from "../domain/terminalRun";
import type { ThreadEvent } from "../domain/threadEvents";
import type { ApprovalGrant, ApprovalRequest } from "./useApprovalQueue";
import { parseCodingPlan } from "../domain/planSchema";
import { tauriWorkspaceStorage } from "../storage/tauriStorage";
import { keychainStorage } from "../storage/keychain";
import { sessionStore } from "../storage/sessionStore";
import { callLLMApi, PLANNER_SYSTEM_PROMPT, cleanJsonOutput } from "../services/llmService";
import { isTauri } from "../utils/tauri";
import { resolveModelSelection } from "./modelSettings";
import { findProvider } from "../providers/providerRegistry";

type NormalizedDecisionQuestion = NonNullable<CodingPlan["decisionQuestions"]>[number];

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
  apiKeys: Record<string, string>;
  credentialVaultProviders: string[];
  credentialVaultAutoUnlock: boolean;
  isRealLLMActive: boolean;
  activeLLMConfig: { provider: LLMProvider; model: string; url?: string } | null;
  activeTitle: string | null;
  outputFiles: string[];
  loadedAgentEvents: any[] | null;
  loadedThreadEvents: ThreadEvent[] | null;
  loadedAgentRunSession: AgentRunSession | null;
  loadedApprovalRequests: ApprovalRequest[] | null;
  loadedApprovalGrants: ApprovalGrant[] | null;
  loadedQuestionRequests: QuestionRequest[] | null;
  loadedActionRequired: ActionRequiredEvent[] | null;
  loadedTerminalRuns: TerminalRun[] | null;

  importPlan: (source: string, fileName?: string) => Promise<boolean>;
  restoreImportedPlan: (plan: ImportedPlanState | null) => void;
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
    autoSelfHeal: true,
    verificationApproval: true,
    fixtureProviderEnabled: true,
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

const WEB_PROVIDER_SETTINGS_KEYS = [
  "orbit-code.provider_settings",
  "agent-gui.provider_settings",
];

export function normalizeProviderSettings(settings: ProviderSettings | null | undefined): ProviderSettings {
  const security = settings?.security || {
    preset: "askBeforeAction",
    advancedRules: {},
    sandboxMode: settings?.sandboxMode || "none",
  };

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
    agent: {
      ...defaultProviderSettings.agent!,
      ...(settings?.agent || {}),
    },
    general: {
      ...defaultProviderSettings.general!,
      ...(settings?.general || {}),
    },
    advanced: {
      ...defaultProviderSettings.advanced!,
      ...(settings?.advanced || {}),
    },
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
      })),
    },
    smokeStatus: settings?.smokeStatus || {},
  };
}

export function useSession(): SessionState {
  const [importedPlan, setImportedPlan] = useState<ImportedPlanState | null>(null);
  const [importError, setImportError] = useState<ImportErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(normalizeProviderSettings(defaultProviderSettings));
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [credentialVaultProviders, setCredentialVaultProviders] = useState<string[]>([]);
  const [credentialVaultAutoUnlock, setCredentialVaultAutoUnlock] = useState(false);
  const [isRealLLMActive, setIsRealLLMActive] = useState(false);
  const [activeLLMConfig, setActiveLLMConfig] = useState<{ provider: LLMProvider; model: string; url?: string } | null>(null);
  const [loadedAgentEvents, setLoadedAgentEvents] = useState<any[] | null>(null);
  const [loadedThreadEvents, setLoadedThreadEvents] = useState<ThreadEvent[] | null>(null);
  const [loadedAgentRunSession, setLoadedAgentRunSession] = useState<AgentRunSession | null>(null);
  const [loadedApprovalRequests, setLoadedApprovalRequests] = useState<ApprovalRequest[] | null>(null);
  const [loadedApprovalGrants, setLoadedApprovalGrants] = useState<ApprovalGrant[] | null>(null);
  const [loadedQuestionRequests, setLoadedQuestionRequests] = useState<QuestionRequest[] | null>(null);
  const [loadedActionRequired, setLoadedActionRequired] = useState<ActionRequiredEvent[] | null>(null);
  const [loadedTerminalRuns, setLoadedTerminalRuns] = useState<TerminalRun[] | null>(null);
  const importRequestSeqRef = useRef(0);

  useEffect(() => {
    const activeSelection = resolveModelSelection(providerSettings, {
      ...apiKeys,
    }, {
      providerId: providerSettings.activeProviderId,
    }, credentialVaultProviders);
    const activeProv = activeSelection?.providerId as LLMProvider | undefined;
    const provider = activeProv ? findProvider(activeProv) : null;
    if (!activeProv) {
      setIsRealLLMActive(false);
      setActiveLLMConfig(null);
      return;
    }
    const activeKey = apiKeys[activeProv];
    if (activeKey || provider?.capabilities.local) {
      setIsRealLLMActive(true);
      const config = providerSettings.configs[activeProv] || {};
      setActiveLLMConfig({
        provider: activeProv,
        model: activeSelection?.model || config.defaultModel || "",
        url: config.baseUrl || ""
      });
    } else {
      setIsRealLLMActive(false);
      setActiveLLMConfig(null);
    }
  }, [providerSettings, apiKeys, credentialVaultProviders]);

  useEffect(() => {
    async function initWorkspace() {
      try {
        const session = await sessionStore.loadSession();
        if (session) {
          if (session.importedPlan) {
            setImportedPlan(session.importedPlan);
          }
          if (session.providerSettings) {
            setProviderSettings(normalizeProviderSettings(session.providerSettings as ProviderSettings));
          }
          if (session.threadEvents && session.threadEvents.length > 0) {
            setLoadedThreadEvents(session.threadEvents);
          }
          if (session.agentEvents && session.agentEvents.length > 0) {
            setLoadedAgentEvents(session.agentEvents);
          }
          if (session.agentRunSession) {
            setLoadedAgentRunSession(session.agentRunSession);
          }
          if (session.approvalRequests) {
            setLoadedApprovalRequests(session.approvalRequests);
          }
          if (session.approvalGrants) {
            setLoadedApprovalGrants(session.approvalGrants);
          }
          if (session.questionRequests) {
            setLoadedQuestionRequests(session.questionRequests);
          }
          if (session.actionRequired) {
            setLoadedActionRequired(session.actionRequired);
          }
          if (session.terminalRuns) {
            setLoadedTerminalRuns(session.terminalRuns);
          }
        } else {
          const stored = await tauriWorkspaceStorage.load();
          if (stored.importedPlan) {
            setImportedPlan(stored.importedPlan);
          }
        }

        let loadedSettings = normalizeProviderSettings(session?.providerSettings as ProviderSettings || defaultProviderSettings);

        if (isTauri()) {
          const rawSettings = await invoke<string | null>("db_get", { key: "provider_settings" });
          if (rawSettings) {
            loadedSettings = normalizeProviderSettings(JSON.parse(rawSettings) as ProviderSettings);
            setProviderSettings(loadedSettings);
          }
        } else {
          const rawSettings = WEB_PROVIDER_SETTINGS_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
          if (rawSettings) {
            loadedSettings = normalizeProviderSettings(JSON.parse(rawSettings) as ProviderSettings);
            setProviderSettings(loadedSettings);
            localStorage.setItem("orbit-code.provider_settings", JSON.stringify(loadedSettings));
          }
        }

        const autoUnlockEnabled = await keychainStorage.isAutoUnlockEnabled().catch(() => false);
        setCredentialVaultAutoUnlock(autoUnlockEnabled);
        const autoUnlockedProviders = autoUnlockEnabled
          ? await keychainStorage.tryAutoUnlock().catch((err) => {
            console.warn("Credential vault auto-unlock failed:", err);
            return [] as string[];
          })
          : [];
        if (autoUnlockedProviders.length > 0) {
          setApiKeys(Object.fromEntries(autoUnlockedProviders.map((provider) => [provider, "__vault_unlocked__"])));
        } else {
          setApiKeys({});
        }
        const savedProviders = await keychainStorage.listSavedProviders();
        setCredentialVaultProviders(savedProviders);
      } catch (err) {
        console.error("Failed to load workspace data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    initWorkspace();
  }, []);

  const updateTask = useCallback((taskId: string, updates: Partial<PlanTask>) => {
    setImportedPlan((prev) => {
      if (!prev) return null;
      const updatedTasks = prev.plan.tasks.map((t) => {
        if (t.id === taskId) {
          return { ...t, ...updates };
        }
        return t;
      });
      const next = {
        ...prev,
        plan: {
          ...prev.plan,
          tasks: updatedTasks,
        },
      };
      tauriWorkspaceStorage.save({ importedPlan: next }).catch(console.error);
      return next;
    });
  }, []);

  const addTask = useCallback((task: PlanTask) => {
    setImportedPlan((prev) => {
      if (!prev) return null;
      const next = {
        ...prev,
        plan: {
          ...prev.plan,
          tasks: [...prev.plan.tasks, task],
        },
      };
      tauriWorkspaceStorage.save({ importedPlan: next }).catch(console.error);
      return next;
    });
  }, []);

  const deleteTask = useCallback((taskId: string) => {
    setImportedPlan((prev) => {
      if (!prev) return null;
      const next = {
        ...prev,
        plan: {
          ...prev.plan,
          tasks: prev.plan.tasks.filter((t) => t.id !== taskId),
        },
      };
      tauriWorkspaceStorage.save({ importedPlan: next }).catch(console.error);
      return next;
    });
  }, []);

  const moveTask = useCallback((taskId: string, direction: "up" | "down") => {
    setImportedPlan((prev) => {
      if (!prev) return null;
      const tasks = [...prev.plan.tasks];
      const index = tasks.findIndex((t) => t.id === taskId);
      if (index === -1) return prev;

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= tasks.length) return prev;

      const temp = tasks[index];
      tasks[index] = tasks[targetIndex];
      tasks[targetIndex] = temp;

      const next = {
        ...prev,
        plan: {
          ...prev.plan,
          tasks,
        },
      };
      tauriWorkspaceStorage.save({ importedPlan: next }).catch(console.error);
      return next;
    });
  }, []);

  const importPlan = useCallback(async (source: string, fileName = "pasted-plan") => {
    const requestSeq = importRequestSeqRef.current + 1;
    importRequestSeqRef.current = requestSeq;
    const isCurrentImport = () => importRequestSeqRef.current === requestSeq;
    const result = parseCodingPlan(source);

    if (!result.ok) {
      if (isRealLLMActive && activeLLMConfig) {
        try {
          const llmPlanOutput = await callLLMApi(
            activeLLMConfig.provider,
            activeLLMConfig.model,
            PLANNER_SYSTEM_PROMPT,
            [
              "Analyze the following coding request and generate a detailed Orbit Code plan.",
              "Use the same language as the user's request for all user-facing plan content.",
              "The plan must be detailed enough for a coding agent to execute with Review Dock approvals and verification.",
              "Include a Summary, deliverables, decision questions, recommended choices, alternative choices, implementation tasks, UI/UX notes when relevant, public interfaces/state changes, test plan, and risks.",
              "If information is missing, do not produce a tiny plan. Put targeted questions in constraints/risks, include a recommended default, and explain how the plan proceeds if the user accepts that default.",
              "For each meaningful choice, include 2-3 options, mark the recommended one first, and describe the tradeoff in practical product or engineering terms.",
              "",
              source,
            ].join("\n"),
            activeLLMConfig.url
          );

          const cleanedJson = cleanJsonOutput(llmPlanOutput);
          const parsedPlan = JSON.parse(cleanedJson);

          const planData: CodingPlan = {
            version: "1",
            title: parsedPlan.title || "LLM 智能开发计划",
            goals: parsedPlan.goals || [],
            constraints: parsedPlan.constraints || [],
            tasks: (parsedPlan.tasks || []).map((t: any, index: number) => ({
              id: t.id || `llm-task-${index}-${Date.now()}`,
              title: t.title || "开发步骤",
              description: t.description || t.details || t.detail || "修改对应文件，并说明具体变更、影响范围和验证方式",
              status: "queued" as const,
              dependsOn: t.dependsOn || [],
              filesHint: t.filesHint || [],
              verification: t.verification || ["npm test"]
            })),
            decisionQuestions: normalizeGeneratedDecisionQuestions(
              parsedPlan.decisionQuestions || parsedPlan.decision_questions || parsedPlan.questions,
            ),
            acceptanceCriteria: parsedPlan.acceptanceCriteria || [],
            risks: parsedPlan.risks || [],
            references: parsedPlan.references || []
          };

          if (!isCurrentImport()) return false;
          const nextPlan = {
            plan: planData,
            fileName,
            importedAt: new Date().toISOString(),
          };

          setImportedPlan(nextPlan);
          await tauriWorkspaceStorage.save({ importedPlan: nextPlan }).catch(console.error);
          sessionStore.savePlan(planData, fileName).catch(console.error);
          setImportError(null);

          setIsLoading(false);
          return true;
        } catch (e: any) {
          if (!isCurrentImport()) return false;
          setImportError({ fileName, errors: [`智能大模型解析计划失败: ${e?.message || String(e)}`] });
          setIsLoading(false);
          return false;
        }
      } else {
        if (!isCurrentImport()) return false;
        const activeSelection = resolveModelSelection(providerSettings, apiKeys, { providerId: providerSettings.activeProviderId }, credentialVaultProviders);
        const provider = activeSelection ? findProvider(activeSelection.providerId) : null;
        const lockedProvider = provider && !provider.capabilities.local && credentialVaultProviders.includes(provider.id) && !apiKeys[provider.id];
        const missingProviderAccess = provider && !provider.capabilities.local && !apiKeys[provider.id];
        const accessError = lockedProvider
          ? `已保存 ${provider.label} API Key，但当前凭据库未解锁。请在“设置 > 模型”解锁后再发送需求生成计划。`
          : missingProviderAccess
            ? `${provider.label} API Key 未配置或未解锁。请先在“设置 > 模型”配置后再发送需求生成计划。`
            : !activeSelection
              ? "请先导入或配置一个模型，再发送自然语言需求生成计划。"
              : "";
        setImportError({ fileName, errors: accessError ? [accessError] : result.errors });
        setIsLoading(false);
        return false;
      }
    }

    if (!isCurrentImport()) return false;
    const nextPlan = {
      plan: result.plan,
      fileName,
      importedAt: new Date().toISOString(),
    };

    setImportedPlan(nextPlan);
    await tauriWorkspaceStorage.save({ importedPlan: nextPlan }).catch(console.error);
    sessionStore.savePlan(result.plan, fileName).catch(console.error);
    setImportError(null);
    setIsLoading(false);
    return true;
  }, [isRealLLMActive, activeLLMConfig, apiKeys, credentialVaultProviders, providerSettings]);

  const clearImportedPlan = useCallback(() => {
    setImportedPlan(null);
    tauriWorkspaceStorage.clear().catch(console.error);
  }, []);

  const restoreImportedPlan = useCallback((plan: ImportedPlanState | null) => {
    setImportedPlan(plan);
    setImportError(null);
    tauriWorkspaceStorage.save({ importedPlan: plan }).catch(console.error);
  }, []);

  const updateProviderSettings = useCallback(async (newSettings: ProviderSettings) => {
    const normalized = normalizeProviderSettings(newSettings);
    setProviderSettings(normalized);
    const raw = JSON.stringify(normalized);
    if (isTauri()) {
      await invoke("db_set", { key: "provider_settings", value: raw }).catch(console.error);
    } else {
      localStorage.setItem("orbit-code.provider_settings", raw);
      localStorage.setItem("agent-gui.provider_settings", raw);
    }
  }, []);

  const unlockCredentialVault = useCallback(async (passphrase: string, rememberDevice = false) => {
    const providers = rememberDevice
      ? await keychainStorage.enableAutoUnlock(passphrase)
      : await keychainStorage.unlock(passphrase);
    setCredentialVaultProviders(providers);
    setApiKeys(Object.fromEntries(providers.map((provider) => [provider, "__vault_unlocked__"])));
    if (rememberDevice) setCredentialVaultAutoUnlock(true);
    return providers;
  }, []);

  const updateApiKey = useCallback(async (providerId: string, key: string, passphrase: string, rememberDevice = false) => {
    await keychainStorage.saveApiKey(providerId, key, passphrase, rememberDevice);
    setCredentialVaultProviders((prev) => [...new Set([...prev, providerId])]);
    setApiKeys((prev) => ({ ...prev, [providerId]: "__vault_unlocked__" }));
    if (rememberDevice) setCredentialVaultAutoUnlock(true);
  }, []);

  const disableCredentialVaultAutoUnlock = useCallback(async () => {
    await keychainStorage.disableAutoUnlock();
    setCredentialVaultAutoUnlock(false);
  }, []);

  const activeTitle = importedPlan?.plan.title ?? null;

  const outputFiles = useMemo(() => {
    if (!importedPlan) return [];
    return [
      importedPlan.fileName,
      ...importedPlan.plan.references,
      ...new Set(importedPlan.plan.tasks.flatMap((task) => task.filesHint)),
    ].slice(0, 7);
  }, [importedPlan]);

  return {
    isLoading,
    importedPlan,
    importError,
    providerSettings,
    apiKeys,
    credentialVaultProviders,
    credentialVaultAutoUnlock,
    isRealLLMActive,
    activeLLMConfig,
    activeTitle,
    outputFiles,
    loadedAgentEvents,
    loadedThreadEvents,
    loadedAgentRunSession,
    loadedApprovalRequests,
    loadedApprovalGrants,
    loadedQuestionRequests,
    loadedActionRequired,
    loadedTerminalRuns,
    importPlan,
    restoreImportedPlan,
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

function normalizeGeneratedDecisionQuestions(input: unknown): CodingPlan["decisionQuestions"] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item): NormalizedDecisionQuestion | null => {
      if (typeof item === "string") {
        const question = item.trim();
        return question ? { question, options: [] } : null;
      }
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const question = typeof record.question === "string" ? record.question.trim() : "";
      if (!question) return null;
      const recommended = typeof record.recommended === "string" ? record.recommended.trim() : "";
      const options = Array.isArray(record.options)
        ? record.options.filter((option): option is string => typeof option === "string" && Boolean(option.trim())).map((option) => option.trim())
        : [];
      return { question, recommended: recommended || undefined, options };
    })
    .filter((item): item is NormalizedDecisionQuestion => Boolean(item));
}
