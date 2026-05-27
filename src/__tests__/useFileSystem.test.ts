import { describe, expect, it } from "vitest";
import { normalizeStoredWorkspaceRoot } from "../state/useFileSystem";

describe("normalizeStoredWorkspaceRoot", () => {
  it("recovers the project root when tauri dev cached src-tauri", () => {
    expect(normalizeStoredWorkspaceRoot("/Users/me/project/src-tauri")).toBe("/Users/me/project");
  });

  it("keeps ordinary workspace roots unchanged", () => {
    expect(normalizeStoredWorkspaceRoot("/Users/me/project")).toBe("/Users/me/project");
    expect(normalizeStoredWorkspaceRoot("src-tauri")).toBe("src-tauri");
  });
});
