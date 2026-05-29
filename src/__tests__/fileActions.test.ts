import { describe, expect, it } from "vitest";
import {
  createFileActionTarget,
  isUnsafeRelativePath,
  looksLikeFilePath,
  parseFileLineColumn,
} from "../domain/fileActions";

describe("file action target", () => {
  it("normalizes workspace-relative and absolute paths while preserving line and column", () => {
    expect(createFileActionTarget({
      workspacePath: "/Users/me/Project",
      path: "/Users/me/Project/src/App.tsx:12:4",
      sourceSurface: "timeline",
    })).toMatchObject({
      workspacePath: "/Users/me/Project",
      relativePath: "src/App.tsx",
      absolutePath: "/Users/me/Project/src/App.tsx",
      line: 12,
      column: 4,
      sourceSurface: "timeline",
    });
  });

  it("rejects workspace escape paths", () => {
    expect(isUnsafeRelativePath("../secret.txt")).toBe(true);
    expect(isUnsafeRelativePath("/tmp/secret.txt")).toBe(true);
    expect(createFileActionTarget({
      workspacePath: "/Users/me/Project",
      path: "../secret.txt",
      sourceSurface: "review",
    })).toBeNull();
  });

  it("detects inline code paths without treating normal prose as files", () => {
    expect(looksLikeFilePath("src/features/review/ReviewDock.tsx")).toBe(true);
    expect(looksLikeFilePath("package.json")).toBe(true);
    expect(looksLikeFilePath("not a path")).toBe(false);
    expect(parseFileLineColumn("src/App.tsx:7")).toEqual({ path: "src/App.tsx", line: 7, column: undefined });
  });
});
