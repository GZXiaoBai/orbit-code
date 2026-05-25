import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/tauri";

export function useWindowActions() {
  const openNewWindow = useCallback(async (projectPath = "Orbit Code") => {
    if (!isTauri()) return;
    try {
      const timestamp = Date.now().toString(36);
      await invoke("create_project_window", {
        projectPath,
        label: timestamp,
      });
    } catch (e) {
      console.error("Failed to create new window:", e);
    }
  }, []);

  return { openNewWindow };
}
