import type { ProjectMenuState } from "../../domain/types";

export function toggleButtonProjectMenu(current: ProjectMenuState | null, workspacePath: string): ProjectMenuState | null {
  if (current?.workspacePath === workspacePath && current.openedBy === "button") return null;
  return { workspacePath, openedBy: "button" };
}

export function openContextProjectMenu(workspacePath: string, x: number, y: number): ProjectMenuState {
  return { workspacePath, x, y, openedBy: "context" };
}
