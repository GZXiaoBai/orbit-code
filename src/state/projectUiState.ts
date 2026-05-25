import type { ProjectUiState } from "../domain/types";
import type { WorkspaceProject } from "./useProjectStore";

export function projectDisplayName(project: WorkspaceProject, ui?: ProjectUiState): string {
  return ui?.displayName?.trim() || project.name;
}

export function applyProjectUiState(projects: WorkspaceProject[], uiState: Record<string, ProjectUiState>): WorkspaceProject[] {
  return [...projects]
    .filter((project) => !uiState[project.workspacePath]?.archived)
    .sort((a, b) => {
      const ap = uiState[a.workspacePath]?.pinned ? 1 : 0;
      const bp = uiState[b.workspacePath]?.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (b.lastOpenedAt || "").localeCompare(a.lastOpenedAt || "");
    })
    .map((project) => ({
      ...project,
      name: projectDisplayName(project, uiState[project.workspacePath]),
    }));
}

export function upsertProjectUiState(
  state: Record<string, ProjectUiState>,
  workspacePath: string,
  patch: Partial<ProjectUiState>,
): Record<string, ProjectUiState> {
  if (!workspacePath) return state;
  return {
    ...state,
    [workspacePath]: {
      ...(state[workspacePath] || {}),
      ...patch,
      workspacePath,
      lastOpenedAt: patch.lastOpenedAt || state[workspacePath]?.lastOpenedAt,
    },
  };
}
