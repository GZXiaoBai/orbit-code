import { useCallback, useEffect, useState } from "react";
import type { LayoutPreferences } from "../domain/types";

const STORAGE_KEY = "agent-gui.layout-preferences.v1";

export const defaultLayoutPreferences: LayoutPreferences = {
  reviewDockVisible: true,
  density: "compact",
  settingsSection: "general",
  composerPinned: true,
};

function loadLayoutPreferences(): LayoutPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayoutPreferences;
    const parsed = JSON.parse(raw) as Partial<LayoutPreferences>;
    return {
      ...defaultLayoutPreferences,
      ...parsed,
      density: parsed.density === "comfortable" ? "comfortable" : "compact",
      reviewDockVisible: parsed.reviewDockVisible !== false,
      settingsSection: typeof parsed.settingsSection === "string" ? parsed.settingsSection : defaultLayoutPreferences.settingsSection,
      composerPinned: parsed.composerPinned !== false,
    };
  } catch {
    return defaultLayoutPreferences;
  }
}

export function useLayoutPreferences() {
  const [layoutPreferences, setLayoutPreferences] = useState<LayoutPreferences>(() => loadLayoutPreferences());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layoutPreferences));
  }, [layoutPreferences]);

  const updateLayoutPreferences = useCallback((patch: Partial<LayoutPreferences>) => {
    setLayoutPreferences((prev) => {
      const settingsSection = typeof patch.settingsSection === "string" ? patch.settingsSection : prev.settingsSection;
      return { ...prev, ...patch, settingsSection };
    });
  }, []);

  const toggleReviewDock = useCallback(() => {
    setLayoutPreferences((prev) => ({ ...prev, reviewDockVisible: !prev.reviewDockVisible }));
  }, []);

  return {
    layoutPreferences,
    updateLayoutPreferences,
    toggleReviewDock,
  };
}
