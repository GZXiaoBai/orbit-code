import { describe, expect, it } from "vitest";
import { PLANNER_SYSTEM_PROMPT } from "../services/llmService";

describe("planner prompt", () => {
  it("requires language matching, questions, options, recommendations, and detailed tasks", () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain("same natural language");
    expect(PLANNER_SYSTEM_PROMPT).toContain("decisionQuestions");
    expect(PLANNER_SYSTEM_PROMPT).toContain("recommended");
    expect(PLANNER_SYSTEM_PROMPT).toContain("1-2 alternatives");
    expect(PLANNER_SYSTEM_PROMPT).toContain("7-14 concrete tasks");
    expect(PLANNER_SYSTEM_PROMPT).toContain("Verification commands");
  });
});
