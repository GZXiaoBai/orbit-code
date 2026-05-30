import { describe, expect, it } from "vitest";
import { PiPackageLoader } from "../runtime/piPackageLoader";

describe("PiPackageLoader", () => {
  it("parses Pi package manifest resources and marks extensions executable", () => {
    const loader = new PiPackageLoader();
    const manifest = loader.scan({
      source: "npm:@demo/pi-tools@1.0.0",
      packageJson: {
        pi: {
          extensions: ["extensions/*.ts"],
          skills: ["skills/review/SKILL.md"],
          prompts: ["prompts/*.md"],
          themes: ["themes/*.json"],
        },
      },
      files: [
        "extensions/index.ts",
        "skills/review/SKILL.md",
        "prompts/review.md",
        "themes/dark.json",
      ],
    });

    expect(manifest.kind).toBe("npm");
    expect(manifest.resources.map((resource) => `${resource.kind}:${resource.path}`)).toEqual([
      "extension:extensions/index.ts",
      "skill:skills/review/SKILL.md",
      "prompt:prompts/review.md",
      "theme:themes/dark.json",
    ]);
    expect(manifest.resources.find((resource) => resource.kind === "extension")?.executable).toBe(true);
    expect(manifest.resources.find((resource) => resource.kind === "extension")).toMatchObject({
      sdkCompatible: true,
      orbitSupported: false,
      blockedReason: expect.stringContaining("extension host"),
    });
    expect(manifest.resources.find((resource) => resource.kind === "skill")).toMatchObject({
      sdkCompatible: true,
      orbitSupported: true,
    });
    expect(manifest.resources.find((resource) => resource.kind === "skill")?.executable).toBe(false);
  });

  it("discovers convention directories and applies Pi filters", () => {
    const loader = new PiPackageLoader();
    const manifest = loader.scan({
      source: "./local-pkg",
      files: [
        "extensions/a.ts",
        "extensions/b.ts",
        "skills/a/SKILL.md",
        "prompts/a.md",
        "themes/a.json",
      ],
      filters: {
        extensions: ["extensions/*.ts", "!extensions/b.ts"],
        skills: [],
        prompts: ["+prompts/manual.md"],
      },
    });

    expect(manifest.kind).toBe("local");
    expect(manifest.resources.map((resource) => `${resource.kind}:${resource.path}`)).toEqual([
      "extension:extensions/a.ts",
      "prompt:prompts/a.md",
      "prompt:prompts/manual.md",
      "theme:themes/a.json",
    ]);
  });

  it("creates controlled install action metadata instead of executing install", () => {
    const loader = new PiPackageLoader();
    expect(loader.install("git:github.com/acme/pi-pkg@v1")).toMatchObject({
      kind: "install",
      tool: "install_pi_package",
      params: { source: "git:github.com/acme/pi-pkg@v1" },
    });
  });
});
