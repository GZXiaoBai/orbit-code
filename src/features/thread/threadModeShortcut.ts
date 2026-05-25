import type { WorkbenchMode } from "../../domain/types";

export function shouldToggleModeFromKey(event: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey">): boolean {
  return event.key === "Tab" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

export function nextWorkbenchMode(mode: WorkbenchMode): WorkbenchMode {
  return mode === "build" ? "plan" : "build";
}
