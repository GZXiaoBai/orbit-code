import type { AppCopy } from "../i18n/copy";
import type { PermissionPreset } from "../domain/types";

export type PermissionControlAction = "openMenu" | "openSecuritySettings";

export const permissionPresetOrder: PermissionPreset[] = ["readOnly", "askBeforeAction", "fullAccess"];

export function getPermissionControlAction(workspaceRoot?: string): PermissionControlAction {
  return workspaceRoot?.trim() ? "openMenu" : "openSecuritySettings";
}

export function getPermissionPresetLabel(copy: AppCopy, preset: PermissionPreset): string {
  if (preset === "readOnly") return copy.security.readOnly;
  if (preset === "fullAccess") return copy.security.fullAccess;
  return copy.security.askFirst;
}
