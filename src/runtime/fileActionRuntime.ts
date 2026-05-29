import type { FileActionTarget, FileOpenAction } from "../domain/fileActions";
import { invokeDesktop, isDesktopRuntime } from "./desktopGateway";

export async function copyFileActionPath(target: FileActionTarget): Promise<void> {
  await navigator.clipboard?.writeText(target.absolutePath);
}

export async function openFileAction(target: FileActionTarget, action: FileOpenAction): Promise<void> {
  if (!isDesktopRuntime()) {
    throw new Error("Desktop runtime is required for opening local files.");
  }
  await invokeDesktop("open_workspace_path", {
    path: target.relativePath,
    workspacePath: target.workspacePath,
    action,
  });
}
