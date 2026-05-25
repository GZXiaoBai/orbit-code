import { describe, expect, it } from "vitest";
import { addRecentFile, buildFileTree, defaultExpandedDirs, filterFileTree, parentDirsForPath } from "../domain/fileTree";

describe("file tree helpers", () => {
  const paths = [
    "README.md",
    "src/App.tsx",
    "src/features/review/ReviewDock.tsx",
    "docs/player-api.md",
    "docs/api-v2.md",
  ];

  it("builds a sorted hierarchical tree with directories first", () => {
    const tree = buildFileTree(paths);

    expect(tree.map((node) => `${node.type}:${node.path}`)).toEqual([
      "directory:docs",
      "directory:src",
      "file:README.md",
    ]);
    expect(tree.find((node) => node.path === "src")?.children?.map((node) => `${node.type}:${node.path}`)).toEqual([
      "directory:src/features",
      "file:src/App.tsx",
    ]);
  });

  it("filters matches while retaining ancestor context", () => {
    const filtered = filterFileTree(buildFileTree(paths), "ReviewDock");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe("src");
    expect(filtered[0].children?.[0].path).toBe("src/features");
    expect(filtered[0].children?.[0].children?.[0].children?.[0].path).toBe("src/features/review/ReviewDock.tsx");
  });

  it("returns parent directories for active file expansion", () => {
    expect(parentDirsForPath("src/features/review/ReviewDock.tsx")).toEqual([
      "src",
      "src/features",
      "src/features/review",
    ]);
  });

  it("expands only active parents by default", () => {
    const expanded = defaultExpandedDirs(paths, "src/features/review/ReviewDock.tsx");

    expect(expanded.has("src")).toBe(true);
    expect(expanded.has("docs")).toBe(false);
    expect(expanded.has("src/features")).toBe(true);
    expect(expanded.has("src/features/review")).toBe(true);
  });

  it("does not auto-expand src-tauri on first project open", () => {
    const expanded = defaultExpandedDirs(["src-tauri/src/lib.rs", "src/App.tsx"], null);

    expect(expanded.has("src-tauri")).toBe(false);
    expect(expanded.has("src")).toBe(false);
  });

  it("deduplicates recent files and enforces the limit", () => {
    expect(addRecentFile(["a.ts", "b.ts"], "a.ts")).toEqual(["a.ts", "b.ts"]);
    expect(addRecentFile(["a.ts", "b.ts", "c.ts"], "d.ts", 3)).toEqual(["d.ts", "a.ts", "b.ts"]);
  });
});
