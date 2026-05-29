import { describe, expect, it, vi } from "vitest";
import { WorkspaceGateway } from "../runtime/workspaceGateway";

vi.mock("../runtime/desktopGateway", () => ({
  isDesktopRuntime: () => true,
  invokeDesktop: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "search_workspace_files") return [`src/App.tsx:1:${args?.query}`];
    if (command === "read_workspace_file") return "content";
    if (command === "list_workspace_files") return ["src/App.tsx"];
    if (command === "run_command_sync") return "ok";
    return null;
  }),
}));

describe("WorkspaceGateway", () => {
  it("requires explicit workspacePath for runtime tools", async () => {
    const gateway = new WorkspaceGateway();
    await expect(gateway.readFile("src/App.tsx", {})).rejects.toThrow("workspacePath is required");
    await expect(gateway.searchCode("App", {})).rejects.toThrow("workspacePath is required");
    await expect(gateway.runCommand({ command: "npm", args: ["test"] }, {})).rejects.toThrow("workspacePath is required");
  });

  it("routes search_code to the Rust search gateway", async () => {
    const gateway = new WorkspaceGateway();
    await expect(gateway.searchCode("ThreadEvent", { workspacePath: "/tmp/project" })).resolves.toEqual([
      "src/App.tsx:1:ThreadEvent",
    ]);
  });
});
