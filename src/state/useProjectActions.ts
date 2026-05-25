import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectUiState } from "../domain/types";
import { isTauri } from "../utils/tauri";
import type { WorkspaceProject } from "./useProjectStore";
import { applyProjectUiState, upsertProjectUiState } from "./projectUiState";

const STORAGE_KEY = "agent-gui.project-ui-state.v1";

function loadProjectUiState(): Record<string, ProjectUiState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ProjectUiState>;
  } catch {
    return {};
  }
}

export function useProjectActions(recentProjects: WorkspaceProject[]) {
  const [projectUiState, setProjectUiState] = useState<Record<string, ProjectUiState>>(() => loadProjectUiState());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projectUiState));
  }, [projectUiState]);

  const visibleProjects = useMemo(
    () => applyProjectUiState(recentProjects, projectUiState),
    [projectUiState, recentProjects],
  );

  const archivedProjects = useMemo(
    () => recentProjects.filter((project) => projectUiState[project.workspacePath]?.archived),
    [projectUiState, recentProjects],
  );

  const updateProjectUi = useCallback((workspacePath: string, patch: Partial<ProjectUiState>) => {
    setProjectUiState((prev) => upsertProjectUiState(prev, workspacePath, patch));
  }, []);

  const togglePinnedProject = useCallback((workspacePath: string) => {
    setProjectUiState((prev) => upsertProjectUiState(prev, workspacePath, {
      pinned: !prev[workspacePath]?.pinned,
    }));
  }, []);

  const archiveProject = useCallback((workspacePath: string, archived = true) => {
    setProjectUiState((prev) => upsertProjectUiState(prev, workspacePath, { archived }));
  }, []);

  const removeRecentProject = useCallback((workspacePath: string) => {
    setProjectUiState((prev) => upsertProjectUiState(prev, workspacePath, { archived: true }));
  }, []);

  const renameProject = useCallback((workspacePath: string, displayName: string) => {
    setProjectUiState((prev) => upsertProjectUiState(prev, workspacePath, { displayName: displayName.trim() || undefined }));
  }, []);

  const revealProject = useCallback(async (workspacePath: string) => {
    if (!workspacePath || !isTauri()) return;
    const { revealItemInDir, openPath } = await import("@tauri-apps/plugin-opener");
    try {
      await revealItemInDir(workspacePath);
    } catch {
      await openPath(workspacePath);
    }
  }, []);

  return {
    projectUiState,
    visibleProjects,
    archivedProjects,
    updateProjectUi,
    togglePinnedProject,
    archiveProject,
    removeRecentProject,
    renameProject,
    revealProject,
  };
}
