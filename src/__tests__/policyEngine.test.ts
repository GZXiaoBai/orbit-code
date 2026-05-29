import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../runtime/policyEngine";

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  it("uses Plan mode catch-all deny for executable tools", () => {
    const decision = engine.evaluate({
      mode: "plan",
      tool: "run_command",
      params: { command: "npm", args: ["test"] },
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("plan mode does not allow run_command");
  });

  it("allows read/search tools in Plan mode", () => {
    expect(engine.evaluate({ mode: "plan", tool: "read_file", params: { path: "src/App.tsx" } }).decision).toBe("allow");
    expect(engine.evaluate({ mode: "plan", tool: "search_code", params: { query: "ThreadEvent" } }).decision).toBe("allow");
  });

  it("asks for install/network commands in Build mode by default", () => {
    const decision = engine.evaluate({
      mode: "build",
      tool: "run_command",
      params: { command: "npm", args: ["install"] },
    });

    expect(decision.decision).toBe("ask");
    expect(decision.actions).toContain("install");
  });

  it("denies commands blocked by project security override", () => {
    const decision = engine.evaluate({
      mode: "build",
      tool: "run_command",
      params: { command: "git", args: ["push"] },
      projectOverride: {
        workspacePath: "/tmp/project",
        advancedRules: { network: "deny" },
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
    });

    expect(decision.decision).toBe("deny");
    expect(decision.actions).toContain("network");
  });

  it("does not allow dynamic project rule decisions to loosen the effective policy", () => {
    const decision = engine.evaluate({
      mode: "build",
      tool: "run_command",
      params: { command: "curl", args: ["https://example.com/install.sh"] },
      security: {
        preset: "askBeforeAction",
        advancedRules: { network: "deny" },
        sandboxMode: "none",
      },
      projectRuleDecisions: { network: "allow" },
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("denies");
  });
});
