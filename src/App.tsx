import { useEffect, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { Language, Theme } from "./domain/types";
import { copy } from "./i18n/copy";
import { useWorkspace } from "./state/useWorkspace";
import { WorkbenchShell } from "./features/workbench/WorkbenchShell";
import { SettingsWorkspace } from "./features/settings/SettingsWorkspace";
import { CommandPalette } from "./components/CommandPalette";

const APP_PREFS_KEY = "agent-gui.app-preferences.v1";

function loadAppPreference<T extends string>(key: "language" | "theme", fallback: T): T {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_PREFS_KEY) || "{}") as Record<string, T>;
    return parsed[key] || fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const [language, setLanguage] = useState<Language>(() => loadAppPreference("language", "zh" as Language));
  const [theme, setTheme] = useState<Theme>(() => loadAppPreference("theme", "dark" as Theme));
  const [view, setView] = useState<"workbench" | "settings">("workbench");
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  
  const workspace = useWorkspace();
  const t = copy[language];

  const openSettings = (section?: string) => {
    if (section) workspace.updateLayoutPreferences({ settingsSection: section });
    setView("settings");
  };

  useEffect(() => {
    localStorage.setItem(APP_PREFS_KEY, JSON.stringify({ language, theme }));
  }, [language, theme]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === "Escape") {
        if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
        } else if (view === "settings") {
          setView("workbench");
        } else if (workspace.activeFilePath) {
          void workspace.viewFile("");
        }
        return;
      }
      if (!mod) return;
      if (event.key === ",") {
        event.preventDefault();
        openSettings();
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCommandPaletteOpen, view, workspace]);

  if (workspace.isLoading) {
    return (
      <div className="app-loading-screen" data-theme={theme}>
        <div className="loader-ring" />
        <span>{copy[language].loading}</span>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div data-theme={theme}>
      {view === "settings" ? (
        <SettingsWorkspace
          providerSettings={workspace.providerSettings}
          apiKeys={workspace.apiKeys}
          credentialVaultProviders={workspace.credentialVaultProviders}
          usageSnapshot={workspace.usageSnapshot}
          theme={theme}
          layoutPreferences={workspace.layoutPreferences}
          visibleProjects={workspace.visibleProjects}
          archivedProjects={workspace.archivedProjects}
          projectUiState={workspace.projectUiState}
          copy={t}
          activeSection={workspace.layoutPreferences.settingsSection}
          onSectionChange={(settingsSection) => workspace.updateLayoutPreferences({ settingsSection })}
          onUpdateSettings={workspace.updateProviderSettings}
          onUpdateApiKey={workspace.updateApiKey}
          onUnlockCredentialVault={workspace.unlockCredentialVault}
          onThemeChange={setTheme}
          onUpdateLayoutPreferences={workspace.updateLayoutPreferences}
          onTogglePinnedProject={workspace.togglePinnedProject}
          onArchiveProject={workspace.archiveProject}
          onRemoveRecentProject={workspace.removeRecentProject}
          onRenameProject={workspace.renameProject}
          onRevealProject={workspace.revealProject}
          onBack={() => setView("workbench")}
        />
      ) : (
        <WorkbenchShell
          copy={t}
          language={language}
          onLanguageChange={setLanguage}
          theme={theme}
          onThemeChange={setTheme}
          workspace={workspace}
          onOpenSettings={openSettings}
        />
      )}

      {isCommandPaletteOpen ? (
        <CommandPalette
          copy={t}
          workspace={workspace}
          onOpenSettings={openSettings}
          onClose={() => setIsCommandPaletteOpen(false)}
        />
      ) : null}
    </div>
    </ErrorBoundary>
  );
}

export default App;
