import { z } from "zod";
import type { ToolName, ToolParams } from "./agentLoop";

const patchSchema = z.object({
  path: z.string().min(1),
  oldContent: z.string().optional().default(""),
  newContent: z.string(),
});

const schemas = {
  read_file: z.object({ path: z.string().min(1) }),
  search_code: z.object({
    query: z.string().min(1).optional(),
    pattern: z.string().min(1).optional(),
  }).refine((value) => Boolean(value.query || value.pattern), "query or pattern is required"),
  list_files: z.object({ filter: z.string().optional() }),
  run_command: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).optional().default([]),
    reason: z.string().min(1),
  }),
  apply_patch: z.object({
    patches: z.array(patchSchema).min(1),
  }),
  ask_user: z.object({ question: z.string().min(1) }),
  done: z.object({ summary: z.string().optional().default("Done") }),
} satisfies Record<ToolName, z.ZodTypeAny>;

const envelopeBaseSchema = z.object({
  tool: z.enum(["read_file", "search_code", "list_files", "run_command", "apply_patch", "ask_user", "done"]),
  params: z.record(z.string(), z.unknown()).default({}),
});

export interface AgentToolEnvelope {
  tool: ToolName;
  params: ToolParams;
}

export interface ToolEnvelopeParseResult {
  envelopes: AgentToolEnvelope[];
  errors: string[];
}

function parseEnvelopeLine(line: string): AgentToolEnvelope {
  const base = envelopeBaseSchema.parse(JSON.parse(line));
  const schema = schemas[base.tool];
  return {
    tool: base.tool,
    params: schema.parse(base.params) as ToolParams,
  };
}

export function parseToolEnvelopes(text: string): ToolEnvelopeParseResult {
  const envelopes: AgentToolEnvelope[] = [];
  const errors: string[] = [];

  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith("{") || !line.endsWith("}")) {
      if (line.includes('"tool"')) errors.push("Tool calls must be strict JSON on a single line.");
      continue;
    }
    try {
      envelopes.push(parseEnvelopeLine(line));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { envelopes, errors };
}
