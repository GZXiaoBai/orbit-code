import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { CodingPlan } from "./types";

const taskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  status: z
    .enum(["queued", "running", "blocked", "review", "verified", "done"])
    .default("queued"),
  depends_on: z.array(z.string()).default([]),
  agent_hint: z.enum(["planner", "coder", "reviewer", "verifier"]).optional(),
  files_hint: z.array(z.string()).default([]),
  verification: z.array(z.string()).default([]),
});

const planSchema = z.object({
  version: z.literal("1").default("1"),
  title: z.string().min(1),
  goals: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  tasks: z.array(taskSchema).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});

export type PlanParseResult =
  | { ok: true; plan: CodingPlan }
  | { ok: false; errors: string[] };

export function parseCodingPlan(source: string): PlanParseResult {
  const body = extractPlanBody(source);

  try {
    const raw = parseYaml(body);
    const parsed = planSchema.safeParse(raw);

    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((issue) => issue.message),
      };
    }

    return {
      ok: true,
      plan: {
        version: parsed.data.version,
        title: parsed.data.title,
        goals: parsed.data.goals,
        constraints: parsed.data.constraints,
        tasks: parsed.data.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          dependsOn: task.depends_on,
          agentHint: task.agent_hint,
          filesHint: task.files_hint,
          verification: task.verification,
        })),
        acceptanceCriteria: parsed.data.acceptance_criteria,
        risks: parsed.data.risks,
        references: parsed.data.references,
      },
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "Unknown parse error"],
    };
  }
}

function extractPlanBody(source: string) {
  const trimmed = source.trim();
  if (!trimmed.startsWith("---")) return trimmed;

  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) return trimmed;
  return trimmed.slice(3, end).trim();
}
