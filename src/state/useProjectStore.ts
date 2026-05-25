import { useCallback, useEffect, useState } from "react";
import { invokeDesktop, isDesktopRuntime } from "../runtime/desktopGateway";

export interface WorkspaceProject {
  id: string;
  name: string;
  workspacePath: string;
  lastOpenedAt: string;
}

function projectIdFromPath(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i += 1) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
  }
  return `project-${Math.abs(hash)}`;
}

function nameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function normalizeProject(row: any): WorkspaceProject {
  return {
    id: String(row.id),
    name: String(row.name),
    workspacePath: String(row.workspace_path ?? row.workspacePath ?? ""),
    lastOpenedAt: String(row.updated_at ?? row.lastOpenedAt ?? ""),
  };
}

export function useProjectStore() {
  const [recentProjects, setRecentProjects] = useState<WorkspaceProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  const refreshProjects = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setRecentProjects([]);
      return;
    }
    setIsLoadingProjects(true);
    try {
      const rows = await invokeDesktop<any[]>("list_projects");
      setRecentProjects(rows.map(normalizeProject).filter((project) => project.workspacePath));
    } catch (error) {
      console.warn("Failed to load projects", error);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const rememberProject = useCallback(async (workspacePath: string) => {
    if (!isDesktopRuntime() || !workspacePath) return;
    const project: WorkspaceProject = {
      id: projectIdFromPath(workspacePath),
      name: nameFromPath(workspacePath),
      workspacePath,
      lastOpenedAt: new Date().toISOString(),
    };
    await invokeDesktop("create_project", {
      id: project.id,
      name: project.name,
      workspacePath: project.workspacePath,
    });
    await refreshProjects();
  }, [refreshProjects]);

  return {
    recentProjects,
    isLoadingProjects,
    rememberProject,
    refreshProjects,
  };
}
