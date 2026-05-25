import { describe, expect, it } from "vitest";
import { formatCommandForDisplay, parseCommandLine } from "../runtime/commandParser";

describe("parseCommandLine", () => {
  it("splits executable and args", () => {
    expect(parseCommandLine("npm test -- --run")).toEqual({
      command: "npm",
      args: ["test", "--", "--run"],
    });
  });

  it("keeps quoted args together", () => {
    expect(parseCommandLine('git commit -m "hello workbench"')).toEqual({
      command: "git",
      args: ["commit", "-m", "hello workbench"],
    });
  });

  it("handles escaped spaces", () => {
    expect(parseCommandLine("open My\\ Project")).toEqual({
      command: "open",
      args: ["My Project"],
    });
  });

  it("returns null for empty input", () => {
    expect(parseCommandLine("   ")).toBeNull();
  });

  it("formats display strings with quoting", () => {
    expect(formatCommandForDisplay("git", ["commit", "-m", "hello workbench"])).toBe('git commit -m "hello workbench"');
  });
});
