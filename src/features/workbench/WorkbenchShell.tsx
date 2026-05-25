import { Languages, Moon, PanelRight, Settings, Sun } from "lucide-react";
import type { Language, Theme } from "../../domain/types";
import type { AppCopy } from "../../i18n/copy";
import type { useWorkspace } from "../../state/useWorkspace";
import { IconButton, StatusBadge } from "../../ui/primitives";
import { ProjectRail } from "../projects/ProjectRail";
import { ReviewDock } from "../review/ReviewDock";
import { ThreadCanvas } from "../thread/ThreadCanvas";

type WorkspaceState = ReturnType<typeof useWorkspace>;

interface WorkbenchShellProps {
  copy: AppCopy;
  language: Language;
  onLanguageChange: (language: Language) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  workspace: WorkspaceState;
  onOpenSettings: (section?: string) => void;
}

export function WorkbenchShell({
  copy,
  language,
  onLanguageChange,
  theme,
  onThemeChange,
  workspace,
  onOpenSettings,
}: WorkbenchShellProps) {
  const nextTheme = theme === "light" ? "dark" : "light";
  const providerLabel = workspace.runControls.selection.model
    ? workspace.runControls.selection.model
    : copy.workbench.providerMissing;

  return (
    <main
      className={`workbench-shell ${workspace.layoutPreferences.reviewDockVisible ? "" : "review-dock-hidden"}`}
      data-theme={theme}
      data-density={workspace.layoutPreferences.density}
    >
      <header className="workbench-header">
        <div className="workbench-brand">
          <span className="workbench-mark">OC</span>
          <div>
            <strong>Orbit Code</strong>
            <small>{copy.workspace}</small>
          </div>
        </div>

        <div className="workbench-project-chip">
          <span>{copy.workbench.headerProject}</span>
          <strong>{workspace.workspaceRoot || copy.workbench.noWorkspace}</strong>
        </div>

        <StatusBadge tone={workspace.runControls.hasModelAccess ? "success" : "warning"}>
          {providerLabel}
        </StatusBadge>

        <div className="workbench-header-actions">
          <IconButton title={copy.langHint} onClick={() => onLanguageChange(language === "zh" ? "en" : "zh")}>
            <Languages size={16} />
          </IconButton>
          <IconButton title={copy.themeToggle} onClick={() => onThemeChange(nextTheme)}>
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </IconButton>
          <IconButton
            title={workspace.layoutPreferences.reviewDockVisible ? copy.workbench.hideReviewDock : copy.workbench.showReviewDock}
            onClick={workspace.toggleReviewDock}
          >
            <PanelRight size={16} />
          </IconButton>
          <IconButton title={copy.settings} onClick={() => onOpenSettings()}>
            <Settings size={16} />
          </IconButton>
        </div>
      </header>

      <div className="workbench-grid">
        <ProjectRail copy={copy} workspace={workspace} onOpenSettings={onOpenSettings} />
        <ThreadCanvas copy={copy} workspace={workspace} onOpenSettings={onOpenSettings} />
        {workspace.layoutPreferences.reviewDockVisible ? <ReviewDock copy={copy} theme={theme} workspace={workspace} /> : null}
      </div>
    </main>
  );
}
