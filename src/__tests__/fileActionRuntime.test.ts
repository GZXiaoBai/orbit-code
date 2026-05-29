import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileActionTarget } from "../domain/fileActions";

const invokeDesktop = vi.fn();

vi.mock("../runtime/desktopGateway", () => ({
  isDesktopRuntime: () => true,
  invokeDesktop,
}));

describe("file action runtime", () => {
  const target: FileActionTarget = {
    workspacePath: "/Users/me/Project",
    relativePath: "src/App.tsx",
    absolutePath: "/Users/me/Project/src/App.tsx",
    sourceSurface: "timeline",
  };

  beforeEach(() => {
    invokeDesktop.mockReset();
  });

  it("dispatches open actions through the desktop gateway", async () => {
    const { openFileAction } = await import("../runtime/fileActionRuntime");
    await openFileAction(target, "vscode");

    expect(invokeDesktop).toHaveBeenCalledWith("open_workspace_path", {
      path: "src/App.tsx",
      workspacePath: "/Users/me/Project",
      action: "vscode",
    });
  });
});
