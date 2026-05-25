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

  it("returns validation errors for invalid plans", () => {
    const result = parseCodingPlan("tasks: []");
    expect(result.ok).toBe(false);
  });
});
