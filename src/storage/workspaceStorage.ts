import type { CodingPlan } from "../domain/types";

const STORAGE_KEY = "agent-gui.workspace.v1";

export interface StoredWorkspace {
  importedPlan: {
    plan: CodingPlan;
    fileName: string;
    importedAt: string;
  } | null;
}

export interface WorkspaceStorage {
  load(): StoredWorkspace | Promise<StoredWorkspace>;
  save(workspace: StoredWorkspace): void | Promise<void>;
  clear(): void | Promise<void>;
}

const emptyWorkspace: StoredWorkspace = {
  importedPlan: null,
};

export const browserWorkspaceStorage: WorkspaceStorage = {
  load() {
    if (typeof window === "undefined") return emptyWorkspace;

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyWorkspace;

    try {
      return JSON.parse(raw) as StoredWorkspace;
    } catch {
      return emptyWorkspace;
    }
  },
  save(workspace) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  },
  clear() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(STORAGE_KEY);
  },
};
