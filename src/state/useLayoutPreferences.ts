import { useCallback, useEffect, useState } from "react";
import type { LayoutPreferences } from "../domain/types";

const STORAGE_KEY = "agent-gui.layout-preferences.v1";

export const defaultLayoutPreferences: LayoutPreferences = {
  reviewDockVisible: true,
  density: "compact",
  settingsSection: "general",
  composerPinned: true,
  showAgentReasoning: true,
  thinkingDisplayPreference: "expanded",
  projectRailWidth: 274,
  reviewDockWidth: 360,
};

function clampWidth(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

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
      showAgentReasoning: parsed.showAgentReasoning !== false,
      thinkingDisplayPreference: parsed.thinkingDisplayPreference === "collapsed" || parsed.thinkingDisplayPreference === "hidden"
        ? parsed.thinkingDisplayPreference
        : parsed.showAgentReasoning === false
          ? "hidden"
          : "expanded",
      projectRailWidth: clampWidth(parsed.projectRailWidth, defaultLayoutPreferences.projectRailWidth || 274, 220, 460),
      reviewDockWidth: clampWidth(parsed.reviewDockWidth, defaultLayoutPreferences.reviewDockWidth || 360, 300, 620),
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
      const next = { ...prev, ...patch, settingsSection };
      return Object.entries(next).every(([key, value]) => prev[key as keyof LayoutPreferences] === value)
        ? prev
        : next;
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
