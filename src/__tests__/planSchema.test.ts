import { describe, expect, it } from "vitest";
import { parseCodingPlan } from "../domain/planSchema";

describe("parseCodingPlan", () => {
  it("parses Plan v1 YAML", () => {
    const result = parseCodingPlan(`
version: "1"
title: Checkout refactor
goals:
  - Fix flaky checkout tests
tasks:
  - id: discover
    title: Discover
    description: Inspect checkout session flow
    depends_on: []
    files_hint:
      - src/checkout/session.ts
    verification:
      - npm test -- checkout
acceptance_criteria:
  - Tests pass
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.title).toBe("Checkout refactor");
    expect(result.plan.tasks[0].dependsOn).toEqual([]);
    expect(result.plan.tasks[0].filesHint).toEqual([
      "src/checkout/session.ts",
    ]);
  });

  it("parses Markdown frontmatter plans", () => {
    const result = parseCodingPlan(`
---
version: "1"
title: Auth cleanup
tasks:
  - id: patch
    title: Patch
---

# Notes for humans
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[0].status).toBe("queued");
  });

  it("accepts camelCase plan fields from generated plans", () => {
    const result = parseCodingPlan(`
version: "1"
title: Generated plan
goals: ["Ship a real workflow"]
tasks:
  - id: implement-ui
    title: Implement UI
    description: Wire the main surface
    dependsOn: ["audit"]
    agentHint: coder
    filesHint: ["src/App.tsx"]
    verification: ["npm run build"]
acceptanceCriteria: ["UI renders without overlap"]
risks: ["Needs visual review"]
references: ["src/App.tsx"]
decisionQuestions:
  - question: "Use compact layout?"
    recommended: "Yes, keep the center thread quiet."
    options: ["Yes", "No, show every event"]
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[0].dependsOn).toEqual(["audit"]);
    expect(result.plan.tasks[0].agentHint).toBe("coder");
    expect(result.plan.tasks[0].filesHint).toEqual(["src/App.tsx"]);
    expect(result.plan.acceptanceCriteria).toEqual(["UI renders without overlap"]);
    expect(result.plan.decisionQuestions?.[0]).toEqual({
      question: "Use compact layout?",
      recommended: "Yes, keep the center thread quiet.",
      options: ["Yes", "No, show every event"],
    });
  });

  it("returns validation errors for invalid plans", () => {
    const result = parseCodingPlan("tasks: []");
    expect(result.ok).toBe(false);
  });
});
