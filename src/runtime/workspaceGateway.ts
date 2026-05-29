import { invokeDesktop, isDesktopRuntime } from "./desktopGateway";

export interface WorkspaceGatewayContext {
  workspacePath?: string;
}

function requireWorkspacePath(context: WorkspaceGatewayContext): string {
  const workspacePath = context.workspacePath?.trim();
  if (!workspacePath) {
    throw new Error("Explicit workspacePath is required for workspace runtime tools.");
  }
  return workspacePath;
}

export class WorkspaceGateway {
  async readFile(path: string, context: WorkspaceGatewayContext): Promise<string> {
    if (!path) throw new Error("path is required");
    if (!isDesktopRuntime()) throw new Error("Desktop runtime required for local file access.");
    return invokeDesktop<string>("read_workspace_file", {
      path,
      workspacePath: requireWorkspacePath(context),
    });
  }

  async listFiles(context: WorkspaceGatewayContext): Promise<string[]> {
    if (!isDesktopRuntime()) throw new Error("Desktop runtime required for local file access.");
    return invokeDesktop<string[]>("list_workspace_files", {
      workspacePath: requireWorkspacePath(context),
    });
  }

  async searchCode(query: string, context: WorkspaceGatewayContext): Promise<string[]> {
    if (!query) throw new Error("query is required");
    if (!isDesktopRuntime()) throw new Error("Desktop runtime required for local code search.");
    return invokeDesktop<string[]>("search_workspace_files", {
      query,
      workspacePath: requireWorkspacePath(context),
      maxResults: 30,
    });
  }

  async runCommand(input: {
    command: string;
    args: string[];
    cwd?: string;
    sandboxMode?: string;
  }, context: WorkspaceGatewayContext): Promise<string> {
    if (!input.command) throw new Error("command is required");
    if (!isDesktopRuntime()) throw new Error("Desktop runtime required for command execution.");
    return invokeDesktop<string>("run_command_sync", {
      command: input.command,
      args: input.args,
      sandboxMode: input.sandboxMode || "none",
      workspacePath: requireWorkspacePath(context),
      cwd: input.cwd || "",
    });
  }
}

export const defaultWorkspaceGateway = new WorkspaceGateway();
