import { describe, expect, it } from "vitest";
import { PLANNER_SYSTEM_PROMPT } from "../services/llmService";
import { parsePlannerJsonOutput } from "../state/plannerEngine";

describe("planner prompt", () => {
  it("requires language matching, questions, options, recommendations, and detailed tasks", () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain("same natural language");
    expect(PLANNER_SYSTEM_PROMPT).toContain("decisionQuestions");
    expect(PLANNER_SYSTEM_PROMPT).toContain("recommended");
    expect(PLANNER_SYSTEM_PROMPT).toContain("1-2 alternatives");
    expect(PLANNER_SYSTEM_PROMPT).toContain("7-14 concrete tasks");
    expect(PLANNER_SYSTEM_PROMPT).toContain("Verification commands");
  });

  it("repairs planner JSON with surrounding prose or a missing final brace", () => {
    const parsed = parsePlannerJsonOutput([
      "Here is the plan:",
      "{",
      "  \"title\": \"审查项目\",",
      "  \"goals\": [\"了解项目\"],",
      "  \"tasks\": [{\"title\":\"读代码\",\"description\":\"只读审查\"}]",
      "",
    ].join("\n")) as { title: string; goals: string[] };

    expect(parsed.title).toBe("审查项目");
    expect(parsed.goals).toEqual(["了解项目"]);
  });
});
