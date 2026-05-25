import { invoke } from "@tauri-apps/api/core";
import { browserWorkspaceStorage } from "./workspaceStorage";
import type { StoredWorkspace } from "./workspaceStorage";
import { isTauri } from "../utils/tauri";

export const tauriWorkspaceStorage = {
  async load(): Promise<StoredWorkspace> {
    if (!isTauri()) {
      return browserWorkspaceStorage.load();
    }
    try {
      const raw = await invoke<string | null>("db_get", { key: "workspace" });
      if (!raw) return { importedPlan: null };
      return JSON.parse(raw) as StoredWorkspace;
    } catch (e) {
      console.warn("Tauri SQLite load failed, falling back to localStorage", e);
      return browserWorkspaceStorage.load();
    }
  },

  async save(workspace: StoredWorkspace): Promise<void> {
    if (!isTauri()) {
      browserWorkspaceStorage.save(workspace);
      return;
    }
    try {
      await invoke("db_set", { key: "workspace", value: JSON.stringify(workspace) });
    } catch (e) {
      console.warn("Tauri SQLite save failed, falling back to localStorage", e);
      browserWorkspaceStorage.save(workspace);
    }
  },

  async clear(): Promise<void> {
    if (!isTauri()) {
      browserWorkspaceStorage.clear();
      return;
    }
    try {
      await invoke("db_delete", { key: "workspace" });
    } catch (e) {
      console.warn("Tauri SQLite clear failed, falling back to localStorage", e);
      browserWorkspaceStorage.clear();
    }
  }
};
