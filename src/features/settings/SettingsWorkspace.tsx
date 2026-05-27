import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Archive,
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
import { addCustomModel, getProviderConfig, setImportedModels, setModelEnabled } from "../../state/modelSettings";
import { getProviderSmokeRecord, setProviderSmokeRecord } from "../../state/providerSmoke";
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
} from "../../domain/types";
import { SelectMenu } from "../../ui/primitives";

type ImportState = "idle" | "importing" | "done" | "error";

interface SettingsWorkspaceProps {
  copy: AppCopy;
  providerSettings: ProviderSettings;
  apiKeys: Record<string, string>;
  credentialVaultProviders: string[];
  credentialVaultAutoUnlock: boolean;
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
    setDraftSettings(providerSettings);
    setLocalApiKeys({});
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
  const activeProviderHasVaultCredential = credentialVaultProviders.includes(activeProvider.id);
  const activeProviderHasDetectedKey = Boolean(apiKeys[activeProvider.id] || localApiKeys[activeProvider.id] || activeProviderHasVaultCredential);
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

  const ensureProviderCredential = async (providerId: string) => {
    const provider = providerRegistry.find((item) => item.id === providerId);
    if (!provider || provider.capabilities.local || apiKeys[providerId]) return true;

    const typedKey = localApiKeys[providerId]?.trim() || "";
    const passphrase = vaultPassphrase.trim();
    if (!passphrase) {
      setVaultMessage(vaultCopy.required);
      return false;
    }

    if (typedKey) {
      await onUpdateApiKey(providerId, typedKey, passphrase, rememberVaultUnlock);
      setVaultMessage(rememberVaultUnlock ? vaultCopy.remembered : vaultCopy.unlocked);
      return true;
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
              <section className="provider-credential-panel">
                {!activeProvider.capabilities.local ? (
                  <>
                    <div className="setting-field">
                      <label><Key size={14} />{activeProvider.apiKeyName || copy.settingsModal.apiKey}</label>
                      <input
                        type="password"
                        value={localApiKeys[activeProvider.id] || ""}
                        onChange={(event) => setLocalApiKeys((prev) => ({ ...prev, [activeProvider.id]: event.target.value }))}
                        placeholder={activeProviderHasVaultCredential
                          ? apiKeys[activeProvider.id] ? vaultCopy.savedUnlocked : vaultCopy.locked
                          : `${copy.settingsModal.apiKeyPlaceholderPrefix} ${activeProvider.apiKeyName || "API Key"}`}
                      />
                    </div>
                    <div className="setting-field">
                      <label><ShieldAlert size={14} />{vaultCopy.passphrase}</label>
                      <input
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
                  <label><Globe size={14} />{copy.settingsModal.baseUrl}</label>
                  <input
                    type="text"
                    value={activeConfig.baseUrl || activeProvider.baseUrl || ""}
                    onChange={(event) => commitSettings({
                      ...draftSettings,
                      configs: {
                        ...draftSettings.configs,
                        [activeProvider.id]: { ...draftSettings.configs[activeProvider.id], baseUrl: event.target.value },
                      },
                    })}
                    placeholder={activeProvider.baseUrl || copy.settingsModal.defaultBaseUrl}
                  />
                </div>
                <div className="provider-import-actions">
                  <button type="button" className="btn btn-save" onClick={() => void importProviderModels(activeProvider.id)}>
                    {importStates[activeProvider.id]?.state === "importing" ? <Loader2 size={14} className="spin-icon" /> : <Cpu size={14} />}
                    {activeConfig.importedModels.length > 0
                      ? copy.settingsModal.refreshModels
                      : activeProviderHasDetectedKey
                        ? copy.settingsModal.restoreModels
                        : copy.settingsModal.importProvider}
                  </button>
                  <button type="button" className="btn" onClick={() => void smokeProvider(activeProvider.id)}>
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
            return (
              <button key={model} type="button" className={`model-toggle-row ${enabled ? "enabled" : ""}`} onClick={() => onToggleModel(provider.id, model, !enabled)}>
                <span><strong>{model}</strong>{config.customModels.includes(model) ? <small>{copy.settingsModal.customModel}</small> : null}</span>
                <span className="model-switch" aria-hidden="true">{enabled ? <Check size={14} /> : null}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
