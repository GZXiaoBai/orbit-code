import { describe, expect, it } from "vitest";
import { defaultLayoutPreferences } from "../state/useLayoutPreferences";

describe("layout preferences", () => {
  it("defaults to a compact workbench with review dock visible", () => {
    expect(defaultLayoutPreferences).toMatchObject({
      density: "compact",
      reviewDockVisible: true,
      settingsSection: "general",
      composerPinned: true,
    });
  });
});
