import { describe, expect, it } from "vitest";
import { openContextProjectMenu, toggleButtonProjectMenu } from "../features/projects/projectMenuState";

describe("project menu state", () => {
  it("toggles a button-opened menu for the same project", () => {
    const opened = toggleButtonProjectMenu(null, "/tmp/app");

    expect(opened).toEqual({ workspacePath: "/tmp/app", openedBy: "button" });
    expect(toggleButtonProjectMenu(opened, "/tmp/app")).toBeNull();
  });

  it("switches projects when another row opens the menu", () => {
    const opened = toggleButtonProjectMenu({ workspacePath: "/tmp/a", openedBy: "button" }, "/tmp/b");

    expect(opened).toEqual({ workspacePath: "/tmp/b", openedBy: "button" });
  });

  it("stores pointer coordinates for context menus", () => {
    expect(openContextProjectMenu("/tmp/app", 40, 80)).toEqual({
      workspacePath: "/tmp/app",
      openedBy: "context",
      x: 40,
      y: 80,
    });
  });
});
