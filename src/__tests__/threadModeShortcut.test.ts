import { describe, expect, it } from "vitest";
import { nextWorkbenchMode, shouldToggleModeFromKey } from "../features/thread/threadModeShortcut";

describe("thread mode shortcut", () => {
  it("uses Shift+Tab without command modifiers", () => {
    expect(shouldToggleModeFromKey({ key: "Tab", shiftKey: true, metaKey: false, ctrlKey: false, altKey: false })).toBe(true);
    expect(shouldToggleModeFromKey({ key: "Tab", shiftKey: true, metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
    expect(shouldToggleModeFromKey({ key: "b", shiftKey: false, metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
  });

  it("toggles plan and build modes", () => {
    expect(nextWorkbenchMode("plan")).toBe("build");
    expect(nextWorkbenchMode("build")).toBe("plan");
  });
});
