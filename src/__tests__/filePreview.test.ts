import { describe, expect, it } from "vitest";
import { buildFilePreviewState, isLargePreview, languageFromPath } from "../domain/filePreview";

describe("file preview helpers", () => {
  it("maps common extensions to Monaco languages", () => {
    expect(languageFromPath("src/App.tsx")).toBe("typescript");
    expect(languageFromPath("src-tauri/src/lib.rs")).toBe("rust");
    expect(languageFromPath("docs/plan.md")).toBe("markdown");
    expect(languageFromPath("unknown.filetype")).toBe("plaintext");
  });

  it("detects large preview mode by line count", () => {
    const largeContent = Array.from({ length: 20_001 }, (_, index) => `line ${index}`).join("\n");

    expect(isLargePreview(largeContent)).toBe(true);
  });

  it("builds loading, empty, and read-only preview states", () => {
    expect(buildFilePreviewState(null, null)).toMatchObject({ loading: false, largeFileMode: false, lineCount: 0 });
    expect(buildFilePreviewState("src/App.tsx", null)).toMatchObject({
      path: "src/App.tsx",
      language: "typescript",
      loading: true,
    });
    expect(buildFilePreviewState("README.md", "# Hello\nWorld")).toMatchObject({
      path: "README.md",
      language: "markdown",
      loading: false,
      largeFileMode: false,
      lineCount: 2,
      content: "# Hello\nWorld",
    });
  });
});
