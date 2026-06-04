import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Archive,
  BookOpenText,
  Check,
  ChevronRight,
  Cpu,
  Globe,
  Key,
  Keyboard,
  Loader2,
  Palette,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Wrench,
} from "lucide-react";
import type { AppCopy } from "../../i18n/copy";
import { providerRegistry } from "../../providers/providerRegistry";
import { discoverProviderModels } from "../../services/modelDiscovery";
import type { CodexRuntimeSettingsModel, ProviderBridgeStatus, ProviderBuildGate } from "../../domain/codex";
import { addCustomModel, buildProviderBuildGate, getProviderConfig, setImportedModels, setModelEnabled } from "../../state/modelSettings";
import { getProviderSmokeRecord, setProviderSmokeRecord } from "../../state/providerSmoke";
import {
  AGENT_RUNTIME_ADAPTER_DECISIONS,
  AGENT_RUNTIME_PROMOTION_REQUIREMENTS,
  PRODUCTION_AGENT_RUNTIME_ADAPTER_ID,
  agentRuntimeEvidenceSummary,
} from "../../runtime/agentRuntimeConformance";
import type { AgentRuntimeEvidenceStatus } from "../../runtime/agentRuntimeConformance";
import type { WorkspaceProject } from "../../state/useProjectStore";
import type { ProviderSettings } from "../../state/useWorkspace";
import type {
  LayoutPreferences,
  PermissionAction,
  PermissionDecision,
  PermissionPreset,
  ProjectUiState,
  SandboxMode,
  Theme,
  UsageSnapshot,
  ContextRule,
  ModelCapability,
} from "../../domain/types";
import { SelectMenu } from "../../ui/primitives";

type ImportState = "idle" | "importing" | "done" | "error";

interface SettingsWorkspaceProps {
  copy: AppCopy;
  providerSettings: ProviderSettings;
  apiKeys: Record<string, string>;
  credentialVaultProviders: string[];
  credentialVaultAutoUnlock: boolean;
  codexRuntimeSettings: CodexRuntimeSettingsModel;
  providerBuildGate: ProviderBuildGate;
  onRestartRuntime?: (providerId?: string) => Promise<unknown> | unknown;
  onRecoverRuntime?: () => Promise<unknown> | unknown;
  usageSnapshot: UsageSnapshot;
  theme: Theme;
  layoutPreferences: LayoutPreferences;
  visibleProjects: WorkspaceProject[];
  archivedProjects: WorkspaceProject[];
  projectUiState: Record<string, ProjectUiState>;
  activeSection: string;
  onSectionChange: (section: string) => void;
  onUpdateSettings: (settings: ProviderSettings) => Promise<void> | void;
  onUpdateApiKey: (providerId: string, key: string, passphrase: string, rememberDevice?: boolean) => Promise<void> | void;
  onUnlockCredentialVault: (passphrase: string, rememberDevice?: boolean) => Promise<string[]> | string[];
  onDisableCredentialVaultAutoUnlock: () => Promise<void> | void;
  onThemeChange: (theme: Theme) => void;
  onUpdateLayoutPreferences: (patch: Partial<LayoutPreferences>) => void;
  onTogglePinnedProject: (workspacePath: string) => void;
  onArchiveProject: (workspacePath: string, archived?: boolean) => void;
  onRemoveRecentProject: (workspacePath: string) => void;
  onRenameProject: (workspacePath: string, displayName: string) => void;
  onRevealProject: (workspacePath: string) => Promise<void> | void;
  onBack: () => void;
}

const permissionActions: PermissionAction[] = ["read", "search", "command", "write", "network", "install", "secrets"];
const permissionDecisions: PermissionDecision[] = ["allow", "ask", "deny"];

function smokeLabel(copy: AppCopy, status: string) {
  if (status === "smokePassed") return copy.settingsModal.smokePassed;
  if (status === "smokeFailed") return copy.settingsModal.smokeFailed;
  if (status === "imported") return copy.settingsModal.smokeImported;
  return copy.settingsModal.smokeNotConfigured;
}

function providerConnectionLabel(
  copy: AppCopy,
  smokeStatus: string,
  options: { local: boolean; imported: boolean; hasUnlockedKey: boolean; hasSavedKey: boolean; hasTypedKey: boolean },
) {
  if (options.local) return smokeLabel(copy, smokeStatus);
  if (options.hasUnlockedKey || options.hasTypedKey) return smokeLabel(copy, smokeStatus);
  if (options.hasSavedKey) return copy.settingsModal.vaultLocked;
  if (options.imported) return copy.settingsModal.vaultNeedsKey;
  return copy.settingsModal.smokeNotConfigured;
}

export function SettingsWorkspace({
  copy,
  providerSettings,
  apiKeys,
  credentialVaultProviders,
  credentialVaultAutoUnlock,
  codexRuntimeSettings,
  onRestartRuntime,
  onRecoverRuntime,
  usageSnapshot,
  theme,
  layoutPreferences,
  visibleProjects,
  archivedProjects,
  projectUiState,
  activeSection,
  onSectionChange,
  onUpdateSettings,
  onUpdateApiKey,
  onUnlockCredentialVault,
  onDisableCredentialVaultAutoUnlock,
  onThemeChange,
  onUpdateLayoutPreferences,
  onTogglePinnedProject,
  onArchiveProject,
  onRemoveRecentProject,
  onRenameProject,
  onRevealProject,
  onBack,
}: SettingsWorkspaceProps) {
  const [draftSettings, setDraftSettings] = useState(providerSettings);
  const [localApiKeys, setLocalApiKeys] = useState<Record<string, string>>({});
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [rememberVaultUnlock, setRememberVaultUnlock] = useState(false);
  const [vaultMessage, setVaultMessage] = useState("");
  const [activeProviderId, setActiveProviderId] = useState(providerSettings.activeProviderId || providerRegistry[0].id);
  const [modelSearch, setModelSearch] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [importStates, setImportStates] = useState<Record<string, { state: ImportState; message?: string }>>({});

  useEffect(() => {
    if (credentialVaultAutoUnlock) setRememberVaultUnlock(true);
  }, [credentialVaultAutoUnlock]);

  useEffect(() => {
    setDraftSettings((current) => current === providerSettings ? current : providerSettings);
    setLocalApiKeys((current) => Object.keys(current).length === 0 ? current : {});
    setActiveProviderId((current) => providerRegistry.some((provider) => provider.id === current)
      ? current
      : providerSettings.activeProviderId || providerRegistry[0].id);
  }, [providerSettings, apiKeys]);

  const navItems = useMemo(() => [
    { id: "general", label: copy.settingsModal.generalTab, icon: Settings },
    { id: "appearance", label: copy.settingsModal.appearanceTab, icon: Palette },
    { id: "models", label: copy.settingsModal.modelsTab, icon: Sparkles },
    { id: "security", label: copy.settingsModal.securityTab, icon: ShieldCheck },
    { id: "agent", label: copy.settingsModal.agentTab, icon: Wrench },
    { id: "context", label: copy.settingsModal.contextTab, icon: BookOpenText },
    { id: "projects", label: copy.settingsModal.projectsTab, icon: Archive },
    { id: "shortcuts", label: copy.settingsModal.shortcutsTab, icon: Keyboard },
    { id: "usage", label: copy.settingsModal.usageTab, icon: Cpu },
    { id: "advanced", label: copy.settingsModal.advancedTab, icon: Wrench },
  ], [copy]);

  const currentSection = useMemo(() => {
    if (navItems.some((item) => item.id === activeSection)) return activeSection;
    if (activeSection === "config") return "security";
    if (activeSection === "personalization") return "agent";
    if (activeSection === "archived") return "projects";
    return "general";
  }, [activeSection, navItems]);

  useEffect(() => {
    if (currentSection !== activeSection) onSectionChange(currentSection);
  }, [activeSection, currentSection, onSectionChange]);

  const activeProvider = providerRegistry.find((provider) => provider.id === activeProviderId) || providerRegistry[0];
  const activeConfig = getProviderConfig(draftSettings, activeProvider.id);
  const activeProviderBaseUrl = activeConfig.baseUrl || activeProvider.baseUrl || "";
  const activeProviderBaseUrlRequired = activeProvider.id === "custom-openai" || activeProvider.id === "azure-openai";
  const activeProviderBaseUrlMissing = activeProviderBaseUrlRequired && !activeProviderBaseUrl.trim();
  const activeProviderApiKeyInputId = `provider-${activeProvider.id}-api-key`;
  const activeProviderVaultPassphraseInputId = `provider-${activeProvider.id}-vault-passphrase`;
  const activeProviderBaseUrlInputId = `provider-${activeProvider.id}-base-url`;
  const activeProviderHasVaultCredential = credentialVaultProviders.includes(activeProvider.id);
  const activeProviderHasDetectedKey = Boolean(apiKeys[activeProvider.id] || localApiKeys[activeProvider.id] || activeProviderHasVaultCredential);
  const activeModelForGate = activeConfig.defaultModel || activeConfig.enabledModels[0] || activeConfig.importedModels[0] || activeConfig.customModels[0] || "";
  const activeProviderBuildGate = useMemo(() => buildProviderBuildGate({
    providerId: activeProvider.id,
    model: activeModelForGate,
    settings: draftSettings,
    apiKeys: { ...apiKeys, ...(localApiKeys[activeProvider.id] ? { [activeProvider.id]: localApiKeys[activeProvider.id] } : {}) },
    savedCredentialProviders: credentialVaultProviders,
    sidecarStatus: codexRuntimeSettings.sidecarStatus,
  }), [activeConfig, activeModelForGate, activeProvider.id, apiKeys, credentialVaultProviders, codexRuntimeSettings.sidecarStatus, draftSettings, localApiKeys]);
  const activeSmokeRecord = getProviderSmokeRecord(draftSettings, activeProvider.id);
  const activeProviderBridgeStatus: ProviderBridgeStatus = useMemo(() => ({
    providerId: activeProvider.id,
    model: activeModelForGate,
    modelDiscovery: activeConfig.importedModels.length > 0 || activeConfig.customModels.length > 0 ? "ready" : "notConfigured",
    bridgeSmoke: activeSmokeRecord.status === "smokePassed" ? "passed" : activeSmokeRecord.status === "smokeFailed" ? "failed" : "notRun",
    buildEnabled: activeProviderBuildGate.canBuild,
    blockedReason: activeProviderBuildGate.blockedReason,
  }), [activeConfig.customModels.length, activeConfig.importedModels.length, activeModelForGate, activeProvider.id, activeProviderBuildGate.blockedReason, activeProviderBuildGate.canBuild, activeSmokeRecord.status]);
  const vaultCopy = {
    passphrase: copy.language === "中" ? "Orbit 凭据库主密码" : "Orbit credential vault passphrase",
    passphraseHelp: copy.language === "中"
      ? "API Key 会加密存入本地 SQLite。可选择信任此设备，之后自动解锁；关闭后重启仍需主密码。"
      : "API keys are encrypted into local SQLite. You may trust this device for automatic unlock; otherwise restart requires the passphrase.",
    unlock: copy.language === "中" ? "解锁凭据库" : "Unlock vault",
    remember: copy.language === "中" ? "信任此设备，重启后自动解锁" : "Trust this device and auto-unlock after restart",
    rememberHelp: copy.language === "中"
      ? "会在本机保存一个受文件权限保护的解锁缓存。方便本机使用，但不适合共享电脑。"
      : "Stores a local unlock cache protected by file permissions. Convenient on your own Mac, not recommended on shared machines.",
    remembered: copy.language === "中" ? "已启用本设备自动解锁" : "Trusted-device auto-unlock enabled",
    forget: copy.language === "中" ? "关闭本设备自动解锁" : "Disable auto-unlock",
    locked: copy.language === "中" ? "已保存密钥，当前未解锁" : "Saved key, currently locked",
    savedUnlocked: copy.language === "中" ? "已保存密钥，凭据库已解锁" : "Saved key, vault unlocked",
    unlocked: copy.language === "中" ? "凭据库已解锁" : "Vault unlocked",
    required: copy.language === "中" ? "请输入凭据库主密码，用于加密或解锁 API Key。" : "Enter the vault passphrase to encrypt or unlock API keys.",
  };
  const security = draftSettings.security || { preset: "askBeforeAction" as const, advancedRules: {}, sandboxMode: "none" as const };
  const agent = draftSettings.agent || {
    maxIterations: 15,
    contextBudget: "balanced" as const,
    autoCompact: true,
    autoSelfHeal: true,
    verificationApproval: true,
    fixtureProviderEnabled: true,
  };
  const contextSettings = draftSettings.context || { userRules: [] };
  const general = draftSettings.general || { startMode: "plan" as const, openLastWorkspace: true };
  const commitSettings = (next: ProviderSettings) => {
    setDraftSettings(next);
    void onUpdateSettings(next);
  };

  const updateSecurity = (patch: Partial<typeof security>) => {
    commitSettings({
      ...draftSettings,
      sandboxMode: patch.sandboxMode || draftSettings.sandboxMode,
      security: {
        ...(draftSettings.security || security),
        ...patch,
        advancedRules: patch.advancedRules || draftSettings.security?.advancedRules || {},
      },
    });
  };

  const updateUserRules = (userRules: ContextRule[]) => {
    commitSettings({
      ...draftSettings,
      context: { ...contextSettings, userRules },
    });
  };

  const addUserRule = () => {
    updateUserRules([
      ...contextSettings.userRules,
      {
        id: `user-rule-${Date.now()}`,
        title: copy.settingsModal.newContextRule,
        content: "",
        enabled: true,
        mode: "both",
        source: "user",
      },
    ]);
  };

  const updateUserRule = (id: string, patch: Partial<ContextRule>) => {
    updateUserRules(contextSettings.userRules.map((rule) => rule.id === id ? { ...rule, ...patch, source: "user" } : rule));
  };

  const removeUserRule = (id: string) => {
    updateUserRules(contextSettings.userRules.filter((rule) => rule.id !== id));
  };

  const ensureProviderCredential = async (providerId: string) => {
    const provider = providerRegistry.find((item) => item.id === providerId);
    if (!provider || provider.capabilities.local) return true;

    const typedKey = localApiKeys[providerId]?.trim() || "";
    const passphrase = vaultPassphrase.trim();

    if (typedKey) {
      if (!passphrase) {
        setVaultMessage(vaultCopy.required);
        return false;
      }
      await onUpdateApiKey(providerId, typedKey, passphrase, rememberVaultUnlock);
      setLocalApiKeys((prev) => ({ ...prev, [providerId]: "" }));
      setVaultMessage(rememberVaultUnlock ? vaultCopy.remembered : vaultCopy.unlocked);
      return true;
    }

    if (apiKeys[providerId]) return true;

    if (!passphrase) {
      setVaultMessage(vaultCopy.required);
      return false;
    }

    if (credentialVaultProviders.includes(providerId)) {
      const providers = await onUnlockCredentialVault(passphrase, rememberVaultUnlock);
      const unlocked = Array.isArray(providers) ? providers.includes(providerId) : true;
      setVaultMessage(unlocked ? (rememberVaultUnlock ? vaultCopy.remembered : vaultCopy.unlocked) : vaultCopy.locked);
      return unlocked;
    }

    setVaultMessage(copy.settingsModal.importMissingKey);
    return false;
  };

  const importProviderModels = async (providerId: string) => {
    const provider = providerRegistry.find((item) => item.id === providerId);
    if (!provider) return;
    const providerBaseUrl = draftSettings.configs[providerId]?.baseUrl || provider.baseUrl || "";
    if ((providerId === "custom-openai" || providerId === "azure-openai") && !providerBaseUrl.trim()) {
      const message = copy.language === "中" ? "请先填写 Base URL。" : "Enter a Base URL first.";
      setImportStates((prev) => ({ ...prev, [providerId]: { state: "error", message } }));
      return;
    }
    const hasCredential = await ensureProviderCredential(providerId);
    if (!provider.capabilities.local && !hasCredential) {
      setImportStates((prev) => ({ ...prev, [providerId]: { state: "error", message: copy.settingsModal.importMissingKey } }));
      return;
    }
    setImportStates((prev) => ({ ...prev, [providerId]: { state: "importing" } }));
    try {
      const discovered = await discoverProviderModels(providerId, draftSettings.configs[providerId]?.baseUrl || provider.baseUrl || "");
      const next = setImportedModels(draftSettings, providerId, discovered);
      commitSettings(setProviderSmokeRecord(next, providerId, {
        status: "imported",
        message: copy.settingsModal.importSuccess.replace("{count}", String(discovered.length)),
      }));
      setActiveProviderId(next.activeProviderId);
      setImportStates((prev) => ({
        ...prev,
        [providerId]: { state: "done", message: copy.settingsModal.importSuccess.replace("{count}", String(discovered.length)) },
      }));
    } catch (error: any) {
      setImportStates((prev) => ({ ...prev, [providerId]: { state: "error", message: error?.message || String(error) } }));
    }
  };

  const smokeProvider = async (providerId: string) => {
    const provider = providerRegistry.find((item) => item.id === providerId);
    if (!provider) return;
    const providerBaseUrl = draftSettings.configs[providerId]?.baseUrl || provider.baseUrl || "";
    if ((providerId === "custom-openai" || providerId === "azure-openai") && !providerBaseUrl.trim()) {
      const message = copy.language === "中" ? "请先填写 Base URL。" : "Enter a Base URL first.";
      setImportStates((prev) => ({ ...prev, [providerId]: { state: "error", message } }));
      return;
    }
    const hasCredential = await ensureProviderCredential(providerId);
    if (!provider.capabilities.local && !hasCredential) {
      commitSettings(setProviderSmokeRecord(draftSettings, providerId, {
        status: "smokeFailed",
        message: copy.settingsModal.importMissingKey,
      }));
      return;
    }
    setImportStates((prev) => ({ ...prev, [providerId]: { state: "importing", message: copy.settingsModal.smokeTest } }));
    try {
      const discovered = await discoverProviderModels(providerId, draftSettings.configs[providerId]?.baseUrl || provider.baseUrl || "");
      commitSettings(setProviderSmokeRecord(draftSettings, providerId, {
        status: "smokePassed",
        message: copy.settingsModal.importSuccess.replace("{count}", String(discovered.length)),
      }));
      setImportStates((prev) => ({ ...prev, [providerId]: { state: "done", message: copy.settingsModal.smokePassed } }));
    } catch (error: any) {
      commitSettings(setProviderSmokeRecord(draftSettings, providerId, {
        status: "smokeFailed",
        message: error?.message || String(error),
      }));
      setImportStates((prev) => ({ ...prev, [providerId]: { state: "error", message: error?.message || String(error) } }));
    }
  };

  return (
    <main className="settings-workspace">
      <aside className="settings-workspace-sidebar">
        <button type="button" className="settings-back-button" onClick={onBack}>
          <ArrowLeft size={15} />
          {copy.backToApp}
        </button>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={currentSection === item.id ? "active" : ""}
                onClick={() => onSectionChange(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="settings-workspace-content">
        {currentSection === "general" ? (
          <SettingsPage title={copy.settingsModal.generalTab} description={copy.settingsModal.generalDescription}>
            <SegmentedSetting
              label={copy.settingsModal.defaultMode}
              value={general.startMode}
              options={[{ value: "plan", label: copy.runControls.plan }, { value: "build", label: copy.runControls.build }]}
              onChange={(value) => commitSettings({ ...draftSettings, general: { ...general, startMode: value as "plan" | "build" } })}
            />
            <ToggleRow
              title={copy.settingsModal.openLastWorkspace}
              description={copy.settingsModal.openLastWorkspaceHelp}
              checked={general.openLastWorkspace}
              onChange={(checked) => commitSettings({ ...draftSettings, general: { ...general, openLastWorkspace: checked } })}
            />
          </SettingsPage>
        ) : null}

        {currentSection === "appearance" ? (
          <SettingsPage title={copy.settingsModal.appearanceTab} description={copy.settingsModal.appearanceDescription}>
            <SegmentedSetting
              label={copy.settingsModal.theme}
              value={theme}
              options={[
                { value: "light", label: copy.settingsModal.lightTheme },
                { value: "dark", label: copy.settingsModal.darkTheme },
              ]}
              onChange={(value) => onThemeChange(value as Theme)}
            />
            <SegmentedSetting
              label={copy.settingsModal.density}
              value={layoutPreferences.density}
              options={[
                { value: "compact", label: copy.settingsModal.compactDensity },
                { value: "comfortable", label: copy.settingsModal.comfortableDensity },
              ]}
              onChange={(value) => onUpdateLayoutPreferences({ density: value as LayoutPreferences["density"] })}
            />
            <ToggleRow
              title={copy.settingsModal.reviewDockDefault}
              description={copy.settingsModal.reviewDockDefaultHelp}
              checked={layoutPreferences.reviewDockVisible}
              onChange={(checked) => onUpdateLayoutPreferences({ reviewDockVisible: checked })}
            />
            <SelectSetting
              label={copy.settingsModal.thinkingDisplay}
              value={layoutPreferences.thinkingDisplayPreference}
              options={[
                { value: "expanded", label: copy.settingsModal.thinkingExpanded },
                { value: "collapsed", label: copy.settingsModal.thinkingCollapsed },
                { value: "hidden", label: copy.settingsModal.thinkingHidden },
              ]}
              onChange={(value) => onUpdateLayoutPreferences({
                thinkingDisplayPreference: value as LayoutPreferences["thinkingDisplayPreference"],
                showAgentReasoning: value !== "hidden",
              })}
            />
          </SettingsPage>
        ) : null}

        {currentSection === "models" ? (
          <div className="settings-two-pane settings-two-pane-page">
            <aside className="provider-list-panel">
              <div className="settings-section-label">{copy.settingsModal.providersTitle}</div>
              {providerRegistry.map((provider) => {
                const config = getProviderConfig(draftSettings, provider.id);
                const imported = config.importedModels.length > 0;
                const hasUnlockedKey = Boolean(apiKeys[provider.id]);
                const hasSavedKey = credentialVaultProviders.includes(provider.id);
                const hasTypedKey = Boolean(localApiKeys[provider.id]);
                const detectedKey = Boolean(hasUnlockedKey || hasTypedKey || hasSavedKey);
                const smoke = getProviderSmokeRecord(draftSettings, provider.id);
                return (
                  <button
                    key={provider.id}
                    className={`provider-import-item ${activeProviderId === provider.id ? "active" : ""}`}
                    onClick={() => {
                      setActiveProviderId(provider.id);
                      if (provider.capabilities.local || imported || detectedKey) {
                        commitSettings({ ...draftSettings, activeProviderId: provider.id });
                      }
                    }}
                  >
                    <span className="provider-import-icon"><Sparkles size={15} /></span>
                    <span>
                      <strong>{provider.label}</strong>
                      <small>
                        {imported ? copy.settingsModal.imported : detectedKey ? copy.settingsModal.detectedApiKey : copy.settingsModal.notImported}
                        {" · "}
                        {providerConnectionLabel(copy, smoke.status, {
                          local: provider.capabilities.local,
                          imported,
                          hasUnlockedKey,
                          hasSavedKey,
                          hasTypedKey,
                        })}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                );
              })}
            </aside>
            <section className="settings-detail-panel">
              <section className="provider-import-hero">
                <div>
                  <p>{copy.settingsModal.modelsTab}</p>
                  <h4>{activeProvider.label}</h4>
                  <span>{copy.settingsModal.importDescription}</span>
                </div>
                <span className={`import-status-chip ${getProviderSmokeRecord(draftSettings, activeProvider.id).status}`}>
                  <Check size={13} />
                  {providerConnectionLabel(copy, getProviderSmokeRecord(draftSettings, activeProvider.id).status, {
                    local: activeProvider.capabilities.local,
                    imported: activeConfig.importedModels.length > 0,
                    hasUnlockedKey: Boolean(apiKeys[activeProvider.id]),
                    hasSavedKey: activeProviderHasVaultCredential,
                    hasTypedKey: Boolean(localApiKeys[activeProvider.id]),
                  })}
                </span>
              </section>
              <CodexRuntimePanel
                copy={copy}
                runtime={codexRuntimeSettings}
                activeGate={activeProviderBuildGate}
                bridgeStatus={activeProviderBridgeStatus}
                onRestart={() => onRestartRuntime?.(activeProvider.id)}
                onRecover={onRecoverRuntime}
              />
              <section className="provider-credential-panel">
                {!activeProvider.capabilities.local ? (
                  <>
                    <div className="setting-field">
                      <label htmlFor={activeProviderApiKeyInputId}><Key size={14} />{activeProvider.apiKeyName || copy.settingsModal.apiKey}</label>
                      <input
                        id={activeProviderApiKeyInputId}
                        type="password"
                        value={localApiKeys[activeProvider.id] || ""}
                        onChange={(event) => setLocalApiKeys((prev) => ({ ...prev, [activeProvider.id]: event.target.value }))}
                        placeholder={activeProviderHasVaultCredential
                          ? apiKeys[activeProvider.id] ? vaultCopy.savedUnlocked : vaultCopy.locked
                          : `${copy.settingsModal.apiKeyPlaceholderPrefix} ${activeProvider.apiKeyName || "API Key"}`}
                      />
                    </div>
                    <div className="setting-field">
                      <label htmlFor={activeProviderVaultPassphraseInputId}><ShieldAlert size={14} />{vaultCopy.passphrase}</label>
                      <input
                        id={activeProviderVaultPassphraseInputId}
                        type="password"
                        value={vaultPassphrase}
                        onChange={(event) => setVaultPassphrase(event.target.value)}
                        placeholder={vaultCopy.passphrase}
                      />
                      <div className="security-notice"><ShieldAlert size={12} /><span>{vaultCopy.passphraseHelp}</span></div>
                    </div>
                    <button
                      type="button"
                      className={`settings-toggle-row vault-remember-row ${rememberVaultUnlock ? "active" : ""}`}
                      onClick={() => setRememberVaultUnlock((value) => !value)}
                    >
                      <span><strong>{vaultCopy.remember}</strong><small>{vaultCopy.rememberHelp}</small></span>
                      <span className="model-switch" aria-hidden="true">{rememberVaultUnlock ? <Check size={14} /> : null}</span>
                    </button>
                    {credentialVaultAutoUnlock ? (
                      <button
                        type="button"
                        className="btn danger-lite"
                        onClick={() => {
                          void onDisableCredentialVaultAutoUnlock();
                          setRememberVaultUnlock(false);
                          setVaultMessage(vaultCopy.locked);
                        }}
                      >
                        <ShieldAlert size={14} />
                        {vaultCopy.forget}
                      </button>
                    ) : null}
                    {activeProviderHasVaultCredential && !apiKeys[activeProvider.id] ? (
                      <button type="button" className="btn" onClick={() => void ensureProviderCredential(activeProvider.id)}>
                        <ShieldCheck size={14} />
                        {vaultCopy.unlock}
                      </button>
                    ) : null}
                    {vaultMessage ? <span className="import-inline-message">{vaultMessage}</span> : null}
                  </>
                ) : null}
                <div className="setting-field">
                  <label htmlFor={activeProviderBaseUrlInputId}><Globe size={14} />{copy.settingsModal.baseUrl}</label>
                  <input
                    id={activeProviderBaseUrlInputId}
                    type="text"
                    value={activeProviderBaseUrl}
                    onChange={(event) => commitSettings({
                      ...draftSettings,
                      configs: {
                        ...draftSettings.configs,
                        [activeProvider.id]: { ...draftSettings.configs[activeProvider.id], baseUrl: event.target.value },
                      },
                    })}
                    placeholder={activeProvider.baseUrl || copy.settingsModal.defaultBaseUrl}
                  />
                  {activeProviderBaseUrlMissing ? (
                    <div className="security-notice"><Globe size={12} /><span>{copy.language === "中" ? "自定义 OpenAI-compatible 服务商需要 Base URL。" : "Custom OpenAI-compatible providers require a Base URL."}</span></div>
                  ) : null}
                </div>
                <div className="provider-import-actions">
                  <button type="button" className="btn btn-save" onClick={() => void importProviderModels(activeProvider.id)} disabled={activeProviderBaseUrlMissing}>
                    {importStates[activeProvider.id]?.state === "importing" ? <Loader2 size={14} className="spin-icon" /> : <Cpu size={14} />}
                    {activeConfig.importedModels.length > 0
                      ? copy.settingsModal.refreshModels
                      : activeProviderHasDetectedKey
                        ? copy.settingsModal.restoreModels
                        : copy.settingsModal.importProvider}
                  </button>
                  <button type="button" className="btn" onClick={() => void smokeProvider(activeProvider.id)} disabled={activeProviderBaseUrlMissing}>
                    <ShieldCheck size={14} />
                    {copy.settingsModal.smokeTest}
                  </button>
                  {importStates[activeProvider.id]?.message ? (
                    <span className={`import-inline-message ${importStates[activeProvider.id]?.state === "error" ? "error" : ""}`}>
                      {importStates[activeProvider.id]?.message}
                    </span>
                  ) : null}
                </div>
              </section>
              <ModelList
                copy={copy}
                settings={draftSettings}
                providerId={activeProvider.id}
                apiKeys={apiKeys}
                credentialVaultProviders={credentialVaultProviders}
                search={modelSearch}
                customModel={customModel}
                onSearchChange={setModelSearch}
                onCustomModelChange={setCustomModel}
                onToggleModel={(providerId, model, enabled) => commitSettings(setModelEnabled(draftSettings, providerId, model, enabled))}
                onAddModel={() => {
                  commitSettings(addCustomModel(draftSettings, activeProviderId, customModel));
                  setCustomModel("");
                }}
              />
            </section>
          </div>
        ) : null}

        {currentSection === "security" ? (
          <SettingsPage title={copy.security.title} description={copy.settingsModal.securityDescription}>
            <SegmentedSetting
              label={copy.security.globalPermission}
              value={security.preset}
              options={[
                { value: "readOnly", label: copy.security.readOnly },
                { value: "askBeforeAction", label: copy.security.askFirst },
                { value: "fullAccess", label: copy.security.fullAccess },
              ]}
              onChange={(value) => updateSecurity({ preset: value as PermissionPreset })}
            />
            <div className="permission-matrix">
              <header><strong>{copy.security.advanced}</strong><small>{copy.settingsModal.sandboxHelp}</small></header>
              {permissionActions.map((action) => (
                <div key={action} className="permission-row">
                  <span>{copy.security[action]}</span>
                  <SelectMenu
                    value={security.advancedRules[action] || ""}
                    ariaLabel={copy.security[action]}
                    onChange={(value) => updateSecurity({
                      advancedRules: {
                        ...security.advancedRules,
                        [action]: (value || undefined) as PermissionDecision | undefined,
                      },
                    })}
                    options={[
                      { value: "", label: copy.settingsModal.presetDefault },
                      ...permissionDecisions.map((decision) => ({ value: decision, label: copy.security[decision] })),
                    ]}
                  />
                </div>
              ))}
            </div>
            <SelectSetting
              label={copy.settingsModal.sandbox}
              value={security.sandboxMode}
              options={[
                { value: "none", label: copy.settingsModal.sandboxNone },
                { value: "restricted", label: copy.settingsModal.sandboxRestricted },
                { value: "docker", label: copy.settingsModal.sandboxDocker },
              ]}
              onChange={(value) => updateSecurity({ sandboxMode: value as SandboxMode })}
            />
          </SettingsPage>
        ) : null}

        {currentSection === "agent" ? (
          <SettingsPage title={copy.settingsModal.agentTab} description={copy.settingsModal.agentDescription}>
            <RangeSetting label={copy.settingsModal.maxIterations} value={agent.maxIterations} min={4} max={30} onChange={(value) => commitSettings({ ...draftSettings, agent: { ...agent, maxIterations: value } })} />
            <ToggleRow title={copy.settingsModal.autoCompact} description={copy.settingsModal.autoCompactHelp} checked={agent.autoCompact} onChange={(checked) => commitSettings({ ...draftSettings, agent: { ...agent, autoCompact: checked } })} />
            <ToggleRow title={copy.settingsModal.selfHeal} description={copy.settingsModal.selfHealHelp} checked={agent.autoSelfHeal} onChange={(checked) => commitSettings({ ...draftSettings, agent: { ...agent, autoSelfHeal: checked } })} />
            <ToggleRow title={copy.settingsModal.fixtureProvider} description={copy.settingsModal.fixtureProviderHelp} checked={agent.fixtureProviderEnabled} onChange={(checked) => commitSettings({ ...draftSettings, agent: { ...agent, fixtureProviderEnabled: checked } })} />
          </SettingsPage>
        ) : null}

        {currentSection === "context" ? (
          <SettingsPage title={copy.settingsModal.contextTab} description={copy.settingsModal.contextDescription}>
            <div className="context-settings-header">
              <div>
                <strong>{copy.settingsModal.userRules}</strong>
                <small>{copy.settingsModal.userRulesHelp}</small>
              </div>
              <button type="button" className="btn btn-save" onClick={addUserRule}>
                <BookOpenText size={14} />
                {copy.settingsModal.addContextRule}
              </button>
            </div>
            {contextSettings.userRules.length === 0 ? (
              <InfoCard title={copy.settingsModal.noContextRules} body={copy.settingsModal.noContextRulesHelp} />
            ) : (
              <div className="context-rule-list">
                {contextSettings.userRules.map((rule, index) => (
                  <article key={rule.id} className={`context-rule-editor ${rule.enabled ? "" : "disabled"}`}>
                    <header>
                      <input
                        value={rule.title}
                        aria-label={`${copy.settingsModal.contextRuleTitle} ${index + 1}`}
                        onChange={(event) => updateUserRule(rule.id, { title: event.target.value })}
                        placeholder={copy.settingsModal.contextRuleTitle}
                      />
                      <SelectMenu
                        value={rule.mode}
                        ariaLabel={copy.settingsModal.contextRuleMode}
                        onChange={(value) => updateUserRule(rule.id, { mode: value as ContextRule["mode"] })}
                        options={[
                          { value: "both", label: copy.settingsModal.contextModeBoth },
                          { value: "plan", label: copy.runControls.plan },
                          { value: "build", label: copy.runControls.build },
                        ]}
                      />
                      <button type="button" className={rule.enabled ? "btn" : "btn danger-lite"} onClick={() => updateUserRule(rule.id, { enabled: !rule.enabled })}>
                        {rule.enabled ? copy.settingsModal.enabled : copy.settingsModal.disabled}
                      </button>
                      <button type="button" className="btn danger-lite" onClick={() => removeUserRule(rule.id)}>
                        <Trash2 size={14} />
                        {copy.settingsModal.remove}
                      </button>
                    </header>
                    <textarea
                      value={rule.content}
                      onChange={(event) => updateUserRule(rule.id, { content: event.target.value })}
                      placeholder={copy.settingsModal.contextRuleContent}
                    />
                  </article>
                ))}
              </div>
            )}
          </SettingsPage>
        ) : null}

        {currentSection === "shortcuts" ? (
          <SettingsPage title={copy.settingsModal.shortcutsTab} description={copy.commandPalette.title}>
            <InfoCard title="Cmd/Ctrl+K" body={copy.commandPalette.placeholder} />
            <InfoCard title="Shift+Tab" body={copy.commandPalette.toggleModeShortcut} />
            <InfoCard title="Cmd/Ctrl+," body={copy.commandPalette.openSettings} />
          </SettingsPage>
        ) : null}

        {currentSection === "projects" ? (
          <SettingsPage title={copy.settingsModal.projectsTab} description={copy.settingsModal.projectsDescription}>
            <ProjectList
              copy={copy}
              title={copy.settingsModal.recentProjects}
              projects={visibleProjects}
              projectUiState={projectUiState}
              empty={copy.workbench.noRecentProjects}
              onTogglePinned={onTogglePinnedProject}
              onArchive={(workspacePath) => onArchiveProject(workspacePath, true)}
              onRemove={onRemoveRecentProject}
              onReveal={onRevealProject}
              onRename={onRenameProject}
            />
            <ProjectList
              copy={copy}
              title={copy.settingsModal.archivedProjects}
              projects={archivedProjects}
              projectUiState={projectUiState}
              empty={copy.settingsModal.noArchivedProjects}
              archived
              onTogglePinned={onTogglePinnedProject}
              onArchive={(workspacePath) => onArchiveProject(workspacePath, false)}
              onRemove={onRemoveRecentProject}
              onReveal={onRevealProject}
              onRename={onRenameProject}
            />
          </SettingsPage>
        ) : null}

        {currentSection === "usage" ? (
          <SettingsPage title={copy.settingsModal.usageTab} description={copy.workbench.usage}>
            <div className="usage-grid">
              <InfoCard title={copy.workbench.commandRuns} body={String(usageSnapshot.commandRuns)} />
              <InfoCard title={copy.workbench.terminalRuns} body={String(usageSnapshot.terminalRuns)} />
              <InfoCard title={copy.workbench.tokenUsage} body={String(usageSnapshot.llmTokens || 0)} />
            </div>
          </SettingsPage>
        ) : null}

        {currentSection === "advanced" ? (
          <SettingsPage title={copy.settingsModal.advancedTab} description={copy.settingsModal.advancedDescription}>
            <ToggleRow
              title={copy.settingsModal.diagnostics}
              description={copy.settingsModal.diagnosticsHelp}
              checked={draftSettings.advanced?.diagnosticsEnabled || false}
              onChange={(checked) => commitSettings({
                ...draftSettings,
                advanced: { ...(draftSettings.advanced || { diagnosticsEnabled: false }), diagnosticsEnabled: checked },
              })}
            />
            <div className="advanced-action-row">
              <span><strong>{copy.settingsModal.exportSettings}</strong><small>{copy.settingsModal.exportSettingsHelp}</small></span>
              <button type="button" className="btn" onClick={() => exportSettingsSnapshot(draftSettings)}>{copy.settingsModal.exportSettings}</button>
            </div>
            <div className="advanced-action-row">
              <span><strong>{copy.settingsModal.resetLocalState}</strong><small>{copy.settingsModal.resetLocalStateHelp}</small></span>
              <button type="button" className="btn danger-lite" onClick={resetLocalUiState}>{copy.settingsModal.resetLocalState}</button>
            </div>
          </SettingsPage>
        ) : null}
      </section>
    </main>
  );
}

function projectName(project: WorkspaceProject, uiState: Record<string, ProjectUiState>) {
  return uiState[project.workspacePath]?.displayName?.trim() || project.name;
}

function ProjectList({
  copy,
  title,
  projects,
  projectUiState,
  empty,
  archived = false,
  onTogglePinned,
  onArchive,
  onRemove,
  onReveal,
  onRename,
}: {
  copy: AppCopy;
  title: string;
  projects: WorkspaceProject[];
  projectUiState: Record<string, ProjectUiState>;
  empty: string;
  archived?: boolean;
  onTogglePinned: (workspacePath: string) => void;
  onArchive: (workspacePath: string) => void;
  onRemove: (workspacePath: string) => void;
  onReveal: (workspacePath: string) => Promise<void> | void;
  onRename: (workspacePath: string, displayName: string) => void;
}) {
  return (
    <section className="settings-project-list">
      <header>
        <strong>{title}</strong>
        <small>{projects.length}</small>
      </header>
      {projects.length === 0 ? <p>{empty}</p> : projects.map((project) => {
        const name = projectName(project, projectUiState);
        const pinned = projectUiState[project.workspacePath]?.pinned;
        return (
          <article key={project.workspacePath} className="settings-project-row">
            <div>
              <strong>{name}</strong>
              <small>{project.workspacePath}</small>
            </div>
            <div className="settings-project-actions">
              <button type="button" className={pinned ? "active" : ""} onClick={() => onTogglePinned(project.workspacePath)}>
                <Archive size={14} />
                {pinned ? copy.workbench.unpinProject : copy.workbench.pinProject}
              </button>
              <button type="button" onClick={() => void onReveal(project.workspacePath)}>
                <Globe size={14} />
                {copy.workbench.openInFinder}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = window.prompt(copy.workbench.renameProject, name);
                  if (next !== null) onRename(project.workspacePath, next);
                }}
              >
                <Wrench size={14} />
                {copy.workbench.renameProject}
              </button>
              <button type="button" onClick={() => onArchive(project.workspacePath)}>
                {archived ? <Undo2 size={14} /> : <Archive size={14} />}
                {archived ? copy.settingsModal.restoreProject : copy.workbench.archiveProject}
              </button>
              {!archived ? (
                <button type="button" onClick={() => onRemove(project.workspacePath)}>
                  <Trash2 size={14} />
                  {copy.workbench.removeProject}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function exportSettingsSnapshot(settings: ProviderSettings) {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "orbit-code-settings.json";
  link.click();
  URL.revokeObjectURL(url);
}

function resetLocalUiState() {
  localStorage.removeItem("agent-gui.layout-preferences.v1");
  localStorage.removeItem("agent-gui.project-ui-state.v1");
  window.location.reload();
}

function SettingsPage({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="settings-page">
      <header><h4>{title}</h4><p>{description}</p></header>
      <div className="settings-page-stack">{children}</div>
    </section>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return <article className="settings-info-card"><strong>{title}</strong><p>{body}</p></article>;
}

function gateLabel(copy: AppCopy, gate: ProviderBuildGate) {
  if (gate.canBuild) return copy.language === "中" ? "Build 已启用" : "Build enabled";
  if (gate.bridgeStatus === "vaultLocked") return copy.language === "中" ? "凭据库未解锁" : "Vault locked";
  if (gate.bridgeStatus === "discovery") return copy.language === "中" ? "等待模型导入" : "Model discovery required";
  return copy.language === "中" ? "Build 已阻止" : "Build blocked";
}

function evidenceStatusLabel(copy: AppCopy, status: AgentRuntimeEvidenceStatus) {
  if (status === "verified") return copy.language === "中" ? "已验证" : "Verified";
  if (status === "partial") return copy.language === "中" ? "部分证据" : "Partial";
  if (status === "design-only") return copy.language === "中" ? "仅设计" : "Design-only";
  if (status === "blocked") return copy.language === "中" ? "已阻塞" : "Blocked";
  return copy.language === "中" ? "未开始" : "Not started";
}

function CodexRuntimePanel({
  copy,
  runtime,
  activeGate,
  bridgeStatus,
  onRestart,
  onRecover,
}: {
  copy: AppCopy;
  runtime: CodexRuntimeSettingsModel;
  activeGate: ProviderBuildGate;
  bridgeStatus: ProviderBridgeStatus;
  onRestart?: () => Promise<unknown> | unknown;
  onRecover?: () => Promise<unknown> | unknown;
}) {
  const [restartPending, setRestartPending] = useState(false);
  const sidecarReady = runtime.sidecarStatus.running;
  const restartRunning = restartPending || runtime.bridgeStatus === "starting";
  const discoveryLabel = bridgeStatus.modelDiscovery === "ready"
    ? (copy.language === "中" ? "Model discovery 已完成" : "Model discovery ready")
    : (copy.language === "中" ? "等待模型导入" : "Model discovery pending");
  const smokeText = bridgeStatus.bridgeSmoke === "passed"
    ? (copy.language === "中" ? "Bridge smoke 已通过" : "Bridge smoke passed")
    : bridgeStatus.bridgeSmoke === "failed"
      ? (copy.language === "中" ? "Bridge smoke 失败" : "Bridge smoke failed")
      : (copy.language === "中" ? "Bridge smoke 未运行" : "Bridge smoke not run");
  const runtimeFailureDetails = [
    runtime.diagnostics?.activeOperation
      ? `operation: ${runtime.diagnostics.activeOperation.kind}/${runtime.diagnostics.activeOperation.status}`
      : "",
    runtime.diagnostics
      ? `pending: responses ${runtime.diagnostics.pendingResponseCount}, requests ${runtime.diagnostics.pendingRequestCount}`
      : "",
    runtime.diagnostics?.lastEventAt
      ? `last event: ${runtime.diagnostics.lastEventAt}`
      : "",
    typeof runtime.diagnostics?.staleEventCount === "number" && runtime.diagnostics.staleEventCount > 0
      ? `stale events: ${runtime.diagnostics.staleEventCount}`
      : "",
    typeof runtime.sidecarStatus.lastExitCode === "number"
      ? (copy.language === "中" ? `退出码 ${runtime.sidecarStatus.lastExitCode}` : `exit ${runtime.sidecarStatus.lastExitCode}`)
      : "",
    runtime.diagnostics?.stderrTail || runtime.sidecarStatus.lastStderrTail
      ? `stderr: ${runtime.diagnostics?.stderrTail || runtime.sidecarStatus.lastStderrTail}`
      : "",
  ].filter(Boolean).join("\n");
  const desktopBuildSmoke = runtime.latestDesktopBuildSmoke
    ? `${runtime.latestDesktopBuildSmoke.result}${runtime.latestDesktopBuildSmoke.liveBuildEnabled ? " · live" : " · readiness"}${runtime.latestDesktopBuildSmoke.path ? ` · ${runtime.latestDesktopBuildSmoke.path}` : ""}`
    : (copy.language === "中" ? "尚无报告" : "No report yet");
  const productionRuntime = AGENT_RUNTIME_ADAPTER_DECISIONS.find((adapter) => adapter.id === PRODUCTION_AGENT_RUNTIME_ADAPTER_ID) || AGENT_RUNTIME_ADAPTER_DECISIONS[0];
  const runtimeEvidenceSummary = agentRuntimeEvidenceSummary(productionRuntime);
  const missingRuntimeEvidenceLabels = runtimeEvidenceSummary.missing.map((requirement) => requirement.label).join(", ");
  const alternativeRuntimes = AGENT_RUNTIME_ADAPTER_DECISIONS.filter((adapter) => adapter.id !== productionRuntime.id);
  return (
    <section className="provider-credential-panel codex-runtime-panel">
      <section className="agent-runtime-summary" aria-label={copy.language === "中" ? "Agent runtime 状态" : "Agent runtime status"}>
        <header>
          <div>
            <strong>{copy.language === "中" ? "Agent runtime" : "Agent runtime"}</strong>
            <small>
              {copy.language === "中"
                ? `Build 核心：${productionRuntime.label}`
                : `Build core: ${productionRuntime.label}`}
            </small>
          </div>
          <span className="agent-runtime-role">
            {copy.language === "中" ? "生产核心" : "Production core"}
          </span>
        </header>
        <div className="agent-runtime-evidence-row">
          {AGENT_RUNTIME_PROMOTION_REQUIREMENTS.map((requirement) => {
            const status = productionRuntime.evidence[requirement.id];
            return (
              <span
                key={requirement.id}
                className={`agent-runtime-evidence-dot ${status}`}
                title={`${requirement.label}: ${evidenceStatusLabel(copy, status)}`}
                aria-label={`${requirement.label}: ${evidenceStatusLabel(copy, status)}`}
              />
            );
          })}
        </div>
        <p>
          {copy.language === "中"
            ? `${runtimeEvidenceSummary.verified}/${runtimeEvidenceSummary.total} 项证据已验证；仍需补齐：${missingRuntimeEvidenceLabels}。替代 Agent 在全部证据 verified 前不会进入生产 Build。`
            : `${runtimeEvidenceSummary.verified}/${runtimeEvidenceSummary.total} evidence checks verified; still missing: ${missingRuntimeEvidenceLabels}. Replacement agents stay out of production Build until every check is verified.`}
        </p>
        <div className="agent-runtime-adapter-list">
          {alternativeRuntimes.map((adapter) => (
            <article key={adapter.id}>
              <span>
                <strong>{adapter.label}</strong>
                <small>{adapter.blockedReason || (copy.language === "中" ? "等待 conformance 证据" : "Waiting for conformance evidence")}</small>
              </span>
              <em>{adapter.role === "blocked" ? (copy.language === "中" ? "blocked" : "blocked") : (copy.language === "中" ? "spike" : "spike")}</em>
            </article>
          ))}
        </div>
      </section>
      <div className="codex-runtime-grid">
        <InfoCard
          title={copy.language === "中" ? "Codex sidecar" : "Codex sidecar"}
          body={sidecarReady
            ? `${runtime.sidecarInfo?.version || "Codex"} · PID ${runtime.sidecarStatus.pid || "-"}`
            : runtime.lastError || (copy.language === "中" ? "尚未启动" : "Not running")}
        />
        <InfoCard
          title={copy.language === "中" ? "Sidecar path" : "Sidecar path"}
          body={runtime.sidecarInfo?.path || runtime.sidecarPath || runtime.sidecarInfo?.source || "-"}
        />
        <InfoCard
          title={copy.language === "中" ? "SHA-256" : "SHA-256"}
          body={runtime.sidecarInfo?.sha256 ? runtime.sidecarInfo.sha256.slice(0, 16) : "-"}
        />
        <InfoCard
          title={copy.language === "中" ? "Responses bridge" : "Responses bridge"}
          body={runtime.bridgeBaseUrl || runtime.bridgeStatus}
        />
        <InfoCard
          title={copy.language === "中" ? "Runtime diagnostics" : "Runtime diagnostics"}
          body={runtimeFailureDetails || runtime.lastError || (copy.language === "中" ? "暂无错误" : "No recent error")}
        />
        <InfoCard
          title={copy.language === "中" ? "Model discovery" : "Model discovery"}
          body={discoveryLabel}
        />
        <InfoCard
          title={copy.language === "中" ? "Bridge smoke" : "Bridge smoke"}
          body={smokeText}
        />
        <InfoCard
          title={copy.language === "中" ? "Desktop Build smoke" : "Desktop Build smoke"}
          body={desktopBuildSmoke}
        />
        <InfoCard
          title={copy.language === "中" ? "Build enabled" : "Build enabled"}
          body={bridgeStatus.blockedReason || activeGate.blockedReason || gateLabel(copy, activeGate)}
        />
      </div>
      <div className={`codex-runtime-status-chip ${activeGate.canBuild ? "smokePassed" : "smokeFailed"}`}>
        <ShieldCheck size={13} />
        {gateLabel(copy, activeGate)}
      </div>
      {onRestart ? (
        <div className="codex-runtime-actions">
          <button
            type="button"
            className="btn"
            disabled={restartRunning}
            onClick={() => {
              setRestartPending(true);
              Promise.resolve()
                .then(() => onRestart())
                .finally(() => setRestartPending(false));
            }}
          >
            <Loader2 size={14} className={restartRunning ? "spin-icon" : undefined} />
            {restartRunning
              ? (copy.language === "中" ? "正在清理..." : "Resetting...")
              : (copy.language === "中" ? "清理 Codex runtime" : "Reset Codex runtime")}
          </button>
          {onRecover ? (
            <button type="button" className="btn btn-ghost" onClick={() => void onRecover()}>
              <Undo2 size={14} />
              {copy.language === "中" ? "恢复输入状态" : "Recover input state"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SegmentedSetting({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <div className="settings-segmented">
        {options.map((option) => <button key={option.value} type="button" className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>{option.label}</button>)}
      </div>
    </div>
  );
}

function SelectSetting({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <SelectMenu value={value} onChange={onChange} ariaLabel={label} options={options} />
    </div>
  );
}

function RangeSetting({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <label className="range-field"><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><strong>{value}</strong></label>
    </div>
  );
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" className={`settings-toggle-row ${checked ? "active" : ""}`} onClick={() => onChange(!checked)}>
      <span><strong>{title}</strong><small>{description}</small></span>
      <span className="model-switch" aria-hidden="true">{checked ? <Check size={14} /> : null}</span>
    </button>
  );
}

function ModelList({
  copy,
  settings,
  providerId,
  apiKeys,
  credentialVaultProviders,
  search,
  customModel,
  onSearchChange,
  onCustomModelChange,
  onToggleModel,
  onAddModel,
}: {
  copy: AppCopy;
  settings: ProviderSettings;
  providerId: string;
  apiKeys: Record<string, string>;
  credentialVaultProviders: string[];
  search: string;
  customModel: string;
  onSearchChange: (value: string) => void;
  onCustomModelChange: (value: string) => void;
  onToggleModel: (providerId: string, model: string, enabled: boolean) => void;
  onAddModel: () => void;
}) {
  const provider = providerRegistry.find((item) => item.id === providerId) || providerRegistry[0];
  const config = getProviderConfig(settings, provider.id);
  const query = search.trim().toLowerCase();
  const models = [...new Set([...config.importedModels, ...config.customModels])].filter((model) => !query || model.toLowerCase().includes(query));
  if (models.length === 0) {
    return <section className="model-empty-panel"><Cpu size={22} /><strong>{copy.settingsModal.noImportedModels}</strong><p>{copy.settingsModal.noImportedModelsBody}</p></section>;
  }
  return (
    <section className="model-settings-page imported-models-page">
      <label className="model-search"><Search size={16} /><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={copy.settingsModal.searchModels} /></label>
      <div className="custom-model-row">
        <input value={customModel} onChange={(event) => onCustomModelChange(event.target.value)} placeholder={copy.settingsModal.customModelName} />
        <button type="button" className="btn btn-save" onClick={onAddModel} disabled={!customModel.trim()}>{copy.settingsModal.addModel}</button>
      </div>
      <div className="model-provider-section imported-model-section">
        <header><Cpu size={16} /><strong>{copy.settingsModal.availableModels}</strong><small>{copy.settingsModal.enabledModelsHint}</small></header>
        <div className="model-toggle-list">
          {models.map((model) => {
            const enabled = config.enabledModels.includes(model);
            const gate = buildProviderBuildGate({
              providerId: provider.id,
              model,
              settings,
              apiKeys,
              savedCredentialProviders: credentialVaultProviders,
            });
            const capability = config.modelCapabilities[model];
            const capabilityBadges = modelCapabilityBadges(copy, capability);
            return (
              <button key={model} type="button" className={`model-toggle-row ${enabled ? "enabled" : ""}`} onClick={() => onToggleModel(provider.id, model, !enabled)}>
                <span className="model-toggle-main">
                  <strong>{model}</strong>
                  <small>{config.customModels.includes(model) ? copy.settingsModal.customModel : gateLabel(copy, gate)}</small>
                  {capabilityBadges.length > 0 ? (
                    <span className="model-capability-badges" aria-label={copy.language === "中" ? "模型能力" : "Model capabilities"}>
                      {capabilityBadges.map((badge) => <span key={badge} className="model-capability-chip">{badge}</span>)}
                    </span>
                  ) : null}
                  {!gate.canBuild && gate.blockedReason ? <small>{gate.blockedReason}</small> : null}
                </span>
                <span className="model-switch" aria-hidden="true">{enabled ? <Check size={14} /> : null}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function compactTokenCount(tokens: number | undefined): string | undefined {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return undefined;
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2).replace(/0+$/, "").replace(/\.$/, "")}M`;
  }
  if (tokens >= 1_000) {
    const value = tokens / 1_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(value >= 100 ? 0 : 1).replace(/0+$/, "").replace(/\.$/, "")}K`;
  }
  return String(tokens);
}

export function modelCapabilityBadges(copy: AppCopy, capability: ModelCapability | undefined): string[] {
  if (!capability) return [];
  const context = compactTokenCount(capability.maxContextTokens);
  const output = compactTokenCount(capability.maxOutputTokens);
  const source = capability.capabilitySource === "api"
    ? "API"
    : capability.capabilitySource === "manual"
      ? copy.language === "中" ? "手动" : "Manual"
      : copy.language === "中" ? "官方" : "Official";
  return [
    context ? `${copy.language === "中" ? "上下文" : "Context"} ${context}` : undefined,
    output ? `${copy.language === "中" ? "输出" : "Output"} ${output}` : undefined,
    capability.toolCalls ? (copy.language === "中" ? "工具" : "Tools") : undefined,
    capability.local ? (copy.language === "中" ? "本地" : "Local") : undefined,
    source,
  ].filter(Boolean) as string[];
}
