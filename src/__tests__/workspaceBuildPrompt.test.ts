import { describe, expect, it } from "vitest";
import type { CodingPlan } from "../domain/types";
import { buildBuildPromptWithAcceptedPlan, type AcceptedBuildPlan } from "../state/useWorkspace";

const plan: CodingPlan = {
  version: "1",
  title: "Fix Build handoff",
  goals: ["Carry the accepted plan into Build"],
  constraints: ["Keep Codex app-server as the Build runtime"],
  tasks: [{
    id: "P0-1",
    title: "Inject plan",
    description: "Build prompt includes accepted plan task context.",
    status: "queued",
    dependsOn: [],
    agentHint: "coder",
    filesHint: ["src/state/useWorkspace.ts"],
    verification: ["npm test -- --run"],
  }],
  acceptanceCriteria: ["Build sees the accepted plan"],
  risks: [],
  references: [],
};

describe("Build prompt handoff", () => {
  it("injects an explicitly accepted Plan draft into Build prompts", () => {
    const acceptedPlan: AcceptedBuildPlan = {
      plan,
      source: "codex-plan-draft",
      acceptedAt: "2026-06-05T00:00:00.000Z",
      title: plan.title,
    };

    const prompt = buildBuildPromptWithAcceptedPlan("Implement P0", acceptedPlan);

    expect(prompt).toContain("Use the accepted Orbit Plan");
    expect(prompt).toContain("Title: Fix Build handoff");
    expect(prompt).toContain("Goals:\n- Carry the accepted plan into Build");
    expect(prompt).toContain("- P0-1: Inject plan");
    expect(prompt).toContain("filesHint: src/state/useWorkspace.ts");
    expect(prompt).toContain("verification: npm test -- --run");
    expect(prompt).toContain("## User Build Request\nImplement P0");
  });

  it("does not alter Build prompts when no Plan draft was accepted", () => {
    expect(buildBuildPromptWithAcceptedPlan("Just build this", null)).toBe("Just build this");
  });
});
