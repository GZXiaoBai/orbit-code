import { useEffect, useRef, useState } from "react";
import { Archive, FolderOpen, MoreHorizontal, Pin, RefreshCcw, Search, Settings, SquarePen, Gauge, ExternalLink, Pencil, Trash2 } from "lucide-react";
import type { ProjectMenuState } from "../../domain/types";
import type { AppCopy } from "../../i18n/copy";
import type { useWorkspace } from "../../state/useWorkspace";
import { useFileTree } from "../../state/useFileTree";
import { Button, EmptyState, IconButton } from "../../ui/primitives";
import { isTauri } from "../../utils/tauri";
import { FileTree } from "./FileTree";
import { openContextProjectMenu, toggleButtonProjectMenu } from "./projectMenuState";

type WorkspaceState = ReturnType<typeof useWorkspace>;

interface ProjectRailProps {
  copy: AppCopy;
  workspace: WorkspaceState;
  onOpenSettings: () => void;
}

export function ProjectRail({ copy, workspace, onOpenSettings }: ProjectRailProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [draftRoot, setDraftRoot] = useState(workspace.workspaceRoot);
  const [manualOpen, setManualOpen] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [menuState, setMenuState] = useState<ProjectMenuState | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const fileTree = useFileTree(workspace.workspaceRoot, workspace.workspaceFiles, workspace.activeFilePath);

  useEffect(() => {
    if (!menuState) return;

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (menuRef.current?.contains(target as Node)) return;
      if (target?.closest("[data-project-menu-trigger='true']")) return;
      setMenuState(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuState(null);
    };

    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuState]);

  const closeProjectMenu = () => setMenuState(null);

  const selectProject = async (workspacePath: string) => {
    closeProjectMenu();
    await workspace.setWorkspaceRoot(workspacePath);
  };

  const openButtonMenu = (workspacePath: string) => {
    setMenuState((current) => toggleButtonProjectMenu(current, workspacePath));
  };

  const openContextMenu = (workspacePath: string, x: number, y: number) => {
    setMenuState(openContextProjectMenu(workspacePath, x, y));
  };

  const openFolder = async () => {
    if (!isTauri()) {
      setManualOpen(true);
      return;
    }
    setIsOpening(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setDraftRoot(selected);
        await workspace.setWorkspaceRoot(selected);
      }
    } finally {
      setIsOpening(false);
    }
  };

  const applyManualPath = async () => {
    if (!draftRoot.trim()) return;
    setIsOpening(true);
    try {
      await workspace.setWorkspaceRoot(draftRoot);
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <aside className="project-rail" aria-label={copy.workbench.projectRail}>
      <header className="rail-header">
        <div>
          <span>{copy.workbench.headerProject}</span>
          <strong>{workspace.workspaceRoot.split(/[\\/]/).filter(Boolean).pop() || copy.workbench.noWorkspace}</strong>
        </div>
        <IconButton title={copy.settings} onClick={() => onOpenSettings()}>
          <Settings size={16} />
        </IconButton>
      </header>

      <div className="rail-actions">
        <Button variant="primary" onClick={openFolder} disabled={isOpening}>
          <FolderOpen size={15} />
          {copy.workbench.openFolder}
        </Button>
        <IconButton title={copy.workbench.manualPath} onClick={() => setManualOpen((value) => !value)}>
          <SquarePen size={15} />
        </IconButton>
        <IconButton title={copy.sidebar.refreshWorkspace} onClick={workspace.refreshFileTree}>
          <RefreshCcw size={15} />
        </IconButton>
      </div>

      {manualOpen ? (
        <div className="manual-path-panel">
          <input
            value={draftRoot}
            onChange={(event) => setDraftRoot(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyManualPath();
              }
            }}
            placeholder={copy.sidebar.workspaceRootPlaceholder}
          />
          <Button onClick={applyManualPath} disabled={isOpening || !draftRoot.trim()}>
            {copy.sidebar.apply}
          </Button>
        </div>
      ) : null}

      {workspace.workspaceError ? <p className="rail-error">{workspace.workspaceError}</p> : null}

      <section className="recent-projects">
        <h2>{copy.workbench.recentProjects}</h2>
        {workspace.visibleProjects.length > 0 ? (
          <div className="recent-list">
            {workspace.visibleProjects.slice(0, 8).map((project) => (
              <div
                key={project.id}
                className={`recent-project-row ${workspace.workspaceRoot === project.workspacePath ? "active" : ""}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openContextMenu(project.workspacePath, event.clientX, event.clientY);
                }}
              >
                <button type="button" onClick={() => void selectProject(project.workspacePath)}>
                  <span>{project.name}</span>
                  <small>{project.workspacePath}</small>
                </button>
                <button
                  type="button"
                  className="project-more-button"
                  aria-label={copy.workbench.projectActions}
                  data-project-menu-trigger="true"
                  onClick={() => openButtonMenu(project.workspacePath)}
                >
                  <MoreHorizontal size={14} />
                </button>
                {menuState?.workspacePath === project.workspacePath ? (
                  <div
                    ref={menuRef}
                    className={`project-context-menu ${menuState.openedBy === "context" ? "context-positioned" : ""}`}
                    style={menuState.openedBy === "context" ? { left: menuState.x, top: menuState.y } : undefined}
                  >
                    <button type="button" onClick={() => { workspace.togglePinnedProject(project.workspacePath); closeProjectMenu(); }}>
                      <Pin size={15} />
                      {workspace.projectUiState[project.workspacePath]?.pinned ? copy.workbench.unpinProject : copy.workbench.pinProject}
                    </button>
                    <button type="button" onClick={() => { void workspace.revealProject(project.workspacePath); closeProjectMenu(); }}>
                      <ExternalLink size={15} />
                      {copy.workbench.openInFinder}
                    </button>
                    <button type="button" onClick={() => {
                      const name = window.prompt(copy.workbench.renameProject, project.name);
                      if (name !== null) workspace.renameProject(project.workspacePath, name);
                      closeProjectMenu();
                    }}>
                      <Pencil size={15} />
                      {copy.workbench.renameProject}
                    </button>
                    <button type="button" onClick={() => { workspace.archiveProject(project.workspacePath, true); closeProjectMenu(); }}>
                      <Archive size={15} />
                      {copy.workbench.archiveProject}
                    </button>
                    <button type="button" onClick={() => { workspace.removeRecentProject(project.workspacePath); closeProjectMenu(); }}>
                      <Trash2 size={15} />
                      {copy.workbench.removeProject}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p>{copy.workbench.noRecentProjects}</p>
        )}
      </section>

      <section className="rail-files">
        <div className="rail-search">
          <Search size={14} />
          <input value={fileTree.filter} onChange={(event) => fileTree.setFilter(event.target.value)} placeholder={copy.workbench.fileSearch} />
        </div>

        {fileTree.filteredNodes.length > 0 ? (
          <FileTree
            nodes={fileTree.filteredNodes}
            expandedDirs={fileTree.expandedDirs}
            activeFilePath={workspace.activeFilePath || undefined}
            filter={fileTree.filter}
            onToggleDir={fileTree.toggleDir}
            onSelectFile={(path) => {
              fileTree.selectFile(path);
              void workspace.viewFile(path);
            }}
          />
        ) : (
          <EmptyState
            icon={<FolderOpen size={20} />}
            title={copy.sidebar.noWorkspaceFiles}
            body={workspace.workspaceRoot ? copy.workbench.fileSearch : copy.workbench.startEmptyBody}
          />
        )}
      </section>

      <footer className="rail-footer">
        <button type="button" className="rail-usage-button" onClick={() => setUsageOpen((value) => !value)}>
          <Gauge size={16} />
          <span>{copy.workbench.usage}</span>
        </button>
        {usageOpen ? (
          <div className="rail-usage-popover">
            <strong>{copy.workbench.usage}</strong>
            <div><span>{copy.workbench.commandRuns}</span><b>{workspace.usageSnapshot.commandRuns}</b></div>
            <div><span>{copy.workbench.terminalRuns}</span><b>{workspace.usageSnapshot.terminalRuns}</b></div>
            <div><span>{copy.workbench.tokenUsage}</span><b>{workspace.usageSnapshot.llmTokens || 0}</b></div>
          </div>
        ) : null}
      </footer>
    </aside>
  );
}
