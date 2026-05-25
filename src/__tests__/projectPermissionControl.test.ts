import { describe, expect, it } from "vitest";
import { copy } from "../i18n/copy";
import {
  getPermissionControlAction,
  getPermissionPresetLabel,
  permissionPresetOrder,
} from "../components/projectPermissionControlModel";

describe("project permission control model", () => {
  it("opens global security settings when no workspace is selected", () => {
    expect(getPermissionControlAction("")).toBe("openSecuritySettings");
    expect(getPermissionControlAction(undefined)).toBe("openSecuritySettings");
  });

  it("opens the project permission menu when a workspace exists", () => {
    expect(getPermissionControlAction("/Users/me/project")).toBe("openMenu");
  });

  it("keeps the permission presets in the visible menu order", () => {
    expect(permissionPresetOrder).toEqual(["readOnly", "askBeforeAction", "fullAccess"]);
    expect(getPermissionPresetLabel(copy.zh, "readOnly")).toBe("只读");
    expect(getPermissionPresetLabel(copy.zh, "askBeforeAction")).toBe("询问");
    expect(getPermissionPresetLabel(copy.zh, "fullAccess")).toBe("全权");
  });
});
