import { useMemo, useState } from "react";
import { Bot, FolderOpen, PanelRight, Search, Settings } from "lucide-react";
import type { AppCopy } from "../i18n/copy";
import type { useWorkspace } from "../state/useWorkspace";

type WorkspaceState = ReturnType<typeof useWorkspace>;

interface CommandPaletteProps {
  copy: AppCopy;
  workspace: WorkspaceState;
  onOpenSettings: (section?: string) => void;
  onClose: () => void;
}

export function CommandPalette({ copy, workspace, onOpenSettings, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const commands = useMemo(() => [
    {
      id: "settings",
      label: copy.commandPalette.openSettings,
      icon: Settings,
      run: () => onOpenSettings(),
    },
    ...[
      ["appearance", copy.settingsModal.appearanceTab],
      ["models", copy.settingsModal.modelsTab],
      ["security", copy.settingsModal.securityTab],
      ["projects", copy.settingsModal.projectsTab],
      ["advanced", copy.settingsModal.advancedTab],
    ].map(([section, label]) => ({
      id: `settings:${section}`,
      label: `${copy.settings}: ${label}`,
      icon: Settings,
      run: () => onOpenSettings(section),
    })),
    {
      id: "build",
      label: copy.commandPalette.toggleBuild,
      icon: Bot,
      run: () => workspace.runControls.setMode(workspace.runControls.mode === "build" ? "plan" : "build"),
    },
    {
      id: "review",
      label: copy.commandPalette.toggleReviewDock,
      icon: PanelRight,
      run: workspace.toggleReviewDock,
    },
    ...workspace.visibleProjects.slice(0, 8).map((project) => ({
      id: `project:${project.id}`,
      label: project.name,
      icon: FolderOpen,
      run: () => void workspace.setWorkspaceRoot(project.workspacePath),
    })),
  ], [copy, onOpenSettings, workspace]);

  const filtered = commands.filter((command) => !normalized || command.label.toLowerCase().includes(normalized));

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <section className="command-palette" onClick={(event) => event.stopPropagation()}>
        <label className="command-palette-search">
          <Search size={17} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.commandPalette.placeholder}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter" && filtered[0]) {
                filtered[0].run();
                onClose();
              }
            }}
          />
        </label>
        <div className="command-palette-list">
          {filtered.length > 0 ? filtered.map((command) => {
            const Icon = command.icon;
            return (
              <button
                key={command.id}
                type="button"
                onClick={() => {
                  command.run();
                  onClose();
                }}
              >
                <Icon size={16} />
                <span>{command.label}</span>
              </button>
            );
          }) : <p>{copy.commandPalette.noResults}</p>}
        </div>
      </section>
    </div>
  );
}
