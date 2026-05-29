import { describe, expect, it } from "vitest";
import { ContextProviderRegistry, RuleContextProvider } from "../runtime/contextProviders";

describe("ContextProviderRegistry", () => {
  it("collects ORBIT.md and .orbit rules as read-only context", async () => {
    const provider = new RuleContextProvider();
    const blocks = await provider.collect({
      mode: "plan",
      readWorkspaceFile: async (path) => {
        if (path === "ORBIT.md") return "Project instructions";
        if (path === ".orbit/rules") return "No shell execution from rules.";
        throw new Error("missing");
      },
    });

    expect(blocks.map((block) => block.title)).toEqual(["ORBIT.md", ".orbit/rules"]);
    expect(ContextProviderRegistry.formatBlocks(blocks)).toContain("does not grant tool permissions");
    expect(blocks[0]).toMatchObject({
      mode: "plan",
      permissionImpact: "none",
      matchedRules: ["ORBIT.md"],
    });
  });

  it("includes accepted plan snapshot as build context", async () => {
    const registry = new ContextProviderRegistry();
    const blocks = await registry.collect({
      mode: "build",
      planSnapshot: {
        version: "1",
        title: "Accepted plan",
        goals: ["Do the thing"],
        constraints: [],
        tasks: [],
        acceptanceCriteria: ["Tests pass"],
        risks: [],
        references: [],
      },
    });

    expect(ContextProviderRegistry.formatBlocks(blocks)).toContain("Accepted Coding Plan");
    expect(ContextProviderRegistry.formatBlocks(blocks)).toContain("Tests pass");
  });

  it("builds an inspector model with token estimates and provider errors", async () => {
    const registry = new ContextProviderRegistry([
      {
        id: "ok",
        collect: async () => [{ id: "rule", title: "ORBIT.md", source: "workspace", content: "Use safe changes." }],
      },
      {
        id: "broken",
        collect: async () => { throw new Error("cannot read rules"); },
      },
    ]);

    const inspector = await registry.collectInspector({ mode: "plan" });

    expect(inspector).toMatchObject({
      mode: "plan",
      source: "context-provider-registry",
      permissionImpact: "none",
      matchedRules: ["ORBIT.md"],
      errors: [{ providerId: "broken", message: "cannot read rules" }],
    });
    expect(inspector.tokenEstimate).toBeGreaterThan(0);
  });

  it("does not inject accepted plans into Plan mode", async () => {
    const registry = new ContextProviderRegistry();
    const blocks = await registry.collect({
      mode: "plan",
      planSnapshot: {
        version: "1",
        title: "Accepted plan",
        goals: ["Do the thing"],
        constraints: [],
        tasks: [],
        acceptanceCriteria: ["Tests pass"],
        risks: [],
        references: [],
      },
    });

    expect(blocks.some((block) => block.id === "plan-snapshot")).toBe(false);
  });

  it("filters user rules by enabled state and mode", async () => {
    const registry = new ContextProviderRegistry();
    const inspector = await registry.collectInspector({
      mode: "plan",
      userRules: [
        { id: "plan-rule", title: "Plan Rule", content: "Plan only", enabled: true, mode: "plan", source: "user" },
        { id: "build-rule", title: "Build Rule", content: "Build only", enabled: true, mode: "build", source: "user" },
        { id: "off-rule", title: "Disabled Rule", content: "Disabled", enabled: false, mode: "both", source: "user" },
      ],
    });

    expect(inspector.blocks.map((block) => block.title)).toContain("Plan Rule");
    expect(inspector.blocks.map((block) => block.title)).not.toContain("Build Rule");
    expect(inspector.disabledBlocks.map((block) => block.title)).toEqual(["Build Rule", "Disabled Rule"]);
    expect(inspector.blocks.every((block) => block.permissionImpact === "none")).toBe(true);
  });

  it("filters user rules by globs, regex, and rule policy without changing permissions", async () => {
    const registry = new ContextProviderRegistry();
    const inspector = await registry.collectInspector({
      mode: "build",
      listWorkspaceFiles: async () => ["src/App.tsx", "README.md"],
      userRules: [
        { id: "matched", title: "React Rule", content: "Prefer hooks", enabled: true, mode: "both", source: "user", globs: ["src/**/*.tsx"], regex: ["hooks"] },
        { id: "missed-glob", title: "Server Rule", content: "Server only", enabled: true, mode: "both", source: "user", globs: ["server/**"] },
        { id: "off", title: "Off Rule", content: "Nope", enabled: true, mode: "both", source: "user", policy: "off" },
        { id: "always", title: "Always Rule", content: "Always include", enabled: true, mode: "build", source: "user", globs: ["missing/**"], policy: "always" },
      ],
    });

    expect(inspector.blocks.map((block) => block.title)).toEqual(["React Rule", "Always Rule"]);
    expect(inspector.blocks.map((block) => block.matchReason)).toEqual(["matched rule filters", "policy always"]);
    expect(inspector.disabledBlocks.map((block) => block.title)).toEqual(["Server Rule", "Off Rule"]);
    expect(inspector.permissionImpact).toBe("none");
  });

  it("discovers mode-filtered project skills as read-only context", async () => {
    const registry = new ContextProviderRegistry();
    const inspector = await registry.collectInspector({
      mode: "build",
      listWorkspaceFiles: async () => [
        ".orbit/skills/review/SKILL.md",
        ".orbit/skills/plan-only/SKILL.md",
        ".orbit/skills/broken/SKILL.md",
      ],
      readWorkspaceFile: async (path) => {
        if (path.includes("review")) {
          return "---\nname: review\ndescription: Review patches\nmodeSlugs:\n  - build\n---\n\n# Review\nCheck tests.";
        }
        if (path.includes("plan-only")) {
          return "---\nname: plan-only\ndescription: Plan only\nmode: plan\n---\n\n# Plan Only";
        }
        return "no title";
      },
    });

    expect(inspector.skills.map((skill) => skill.name)).toEqual(["review"]);
    expect(inspector.blocks.some((block) => block.title === "Skill: review")).toBe(true);
    expect(inspector.blocks.some((block) => block.content.includes("does not grant extra tools"))).toBe(true);
    expect(inspector.errors[0]?.message).toContain(".orbit/skills/broken/SKILL.md");
  });

  it("surfaces external rule files as disabled import candidates without injecting them", async () => {
    const registry = new ContextProviderRegistry();
    const inspector = await registry.collectInspector({
      mode: "plan",
      listWorkspaceFiles: async () => [
        "AGENTS.md",
        "CLAUDE.md",
        ".cursor/rules/project.mdc",
      ],
      readWorkspaceFile: async () => {
        throw new Error("External candidates should not be read automatically");
      },
    });

    expect(inspector.externalRuleCandidates).toEqual([
      { path: "AGENTS.md", title: "AGENTS.md", enabled: false },
      { path: "CLAUDE.md", title: "CLAUDE.md", enabled: false },
      { path: ".cursor/rules", title: ".cursor/rules", enabled: false },
    ]);
    expect(inspector.blocks.some((block) => block.title === "AGENTS.md")).toBe(false);
    expect(inspector.permissionImpact).toBe("none");
  });
});
