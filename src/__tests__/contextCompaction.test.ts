import { describe, expect, it } from "vitest";
import { buildDeterministicContextSummary, contextBudgetTriggerRatio, shouldCompactContext } from "../domain/contextCompaction";
import type { AgentSettings } from "../domain/types";

const settings: AgentSettings = {
  maxIterations: 15,
  contextBudget: "balanced",
  autoCompact: true,
  autoSelfHeal: true,
  verificationApproval: true,
  fixtureProviderEnabled: true,
};

describe("context compaction", () => {
  it("maps context budget to trigger ratios", () => {
    expect(contextBudgetTriggerRatio("compact")).toBe(0.55);
    expect(contextBudgetTriggerRatio("balanced")).toBe(0.70);
    expect(contextBudgetTriggerRatio("large")).toBe(0.82);
  });

  it("triggers after the selected model context budget is crossed", () => {
    const messages = [{ role: "user" as const, content: "x".repeat(3200) }];
    const result = shouldCompactContext({ settings, maxContextTokens: 1000, messages, iteration: 3 });

    expect(result.shouldCompact).toBe(true);
    expect(result.state.sourceTokenEstimate).toBe(800);
    expect(result.state.triggerRatio).toBe(0.70);
  });

  it("does not compact when disabled", () => {
    const result = shouldCompactContext({
      settings: { ...settings, autoCompact: false },
      maxContextTokens: 1000,
      messages: [{ role: "assistant", content: "x".repeat(8000) }],
      iteration: 5,
    });

    expect(result.shouldCompact).toBe(false);
  });

  it("builds a deterministic summary for fallback compaction", () => {
    const summary = buildDeterministicContextSummary([
      { role: "user", content: "Implement a thing" },
      { role: "assistant", content: "Read file and proposed patch" },
    ]);

    expect(summary).toContain("Context was automatically compressed");
    expect(summary).toContain("Implement a thing");
  });
});
