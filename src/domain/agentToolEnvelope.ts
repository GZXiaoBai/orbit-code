import { z } from "zod";
import type { ToolName, ToolParams } from "./agentLoop";

export const MAX_PATCHES_PER_TOOL_CALL = 3;
export const MAX_PATCH_CONTENT_CHARS = 30_000;

const patchSchema = z.object({
  path: z.string().min(1),
  oldContent: z.string().optional().default(""),
  newContent: z.string().max(
    MAX_PATCH_CONTENT_CHARS,
    `newContent is too large for one patch. Split the work into smaller propose_patch calls.`,
  ),
});

const questionOptionSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1),
  description: z.string().optional().default(""),
  recommended: z.boolean().optional().default(false),
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
    cwd: z.string().optional(),
  }),
  apply_patch: z.object({
    patches: z.array(patchSchema).min(1).max(
      MAX_PATCHES_PER_TOOL_CALL,
      `Too many files in one propose_patch. Send at most ${MAX_PATCHES_PER_TOOL_CALL} files, then wait for the user to apply the current patch and continue later.`,
    ),
  }),
  propose_patch: z.object({
    patches: z.array(patchSchema).min(1).max(
      MAX_PATCHES_PER_TOOL_CALL,
      `Too many files in one propose_patch. Send at most ${MAX_PATCHES_PER_TOOL_CALL} files, then wait for the user to apply the current patch and continue later.`,
    ),
  }),
  ask_user: z.object({
    question: z.string().min(1),
    options: z.array(questionOptionSchema).optional().default([]),
    allowFreeform: z.boolean().optional().default(false),
  }),
  done: z.object({ summary: z.string().optional().default("Done") }),
  done_plan: z.object({ summary: z.string().optional().default("Done") }),
  done_build: z.object({ summary: z.string().optional().default("Done") }),
} satisfies Record<ToolName, z.ZodTypeAny>;

const toolAliases: Record<string, ToolName> = {
  读取文件: "read_file",
  读文件: "read_file",
  搜索代码: "search_code",
  搜索: "search_code",
  列出文件: "list_files",
  文件列表: "list_files",
  命令: "run_command",
  运行命令: "run_command",
  执行命令: "run_command",
  补丁: "apply_patch",
  修改: "apply_patch",
  提交补丁: "apply_patch",
  提出补丁: "propose_patch",
  问题: "ask_user",
  提问: "ask_user",
  询问: "ask_user",
  完成: "done",
  总结: "done",
  完成计划: "done_plan",
  完成执行: "done_build",
};

function canonicalizeToolName(tool: unknown): ToolName | unknown {
  if (typeof tool !== "string") return tool;
  return toolAliases[tool.trim()] || tool;
}

const envelopeBaseSchema = z.object({
  tool: z.preprocess(
    canonicalizeToolName,
    z.enum(["read_file", "search_code", "list_files", "run_command", "apply_patch", "propose_patch", "ask_user", "done", "done_plan", "done_build"]),
  ),
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

export function looksLikeNonStrictPatchProposal(text: string): boolean {
  return /<\s*(?:补丁|patch)\s*>/i.test(text)
    || /"\s*patches\s*"\s*:/.test(text)
    || /\b(?:oldContent|newContent)\b/.test(text)
    || /(?:patch|patches|补丁).{0,80}(?:review|审查台|proposed|提出)/i.test(text);
}

function parseEnvelopeLine(line: string): AgentToolEnvelope {
  const base = envelopeBaseSchema.parse(JSON.parse(line));
  const schema = schemas[base.tool];
  return {
    tool: base.tool,
    params: schema.parse(base.params) as ToolParams,
  };
}

function humanizeParseError(error: unknown, candidate: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    candidate.includes('"tool"')
    && /JSON Parse error|Unexpected end|Expected|unterminated|end of JSON|position/i.test(message)
  ) {
    return [
      message,
      "The tool call JSON appears incomplete or truncated.",
      `For propose_patch, send at most ${MAX_PATCHES_PER_TOOL_CALL} small files per call and stop after Orbit receives the patch proposal.`,
      "Do not include every project file in a single tool call.",
    ].join("\n");
  }
  return message;
}

function extractBalancedJsonObjects(text: string): Array<{ json: string; start: number; end: number }> {
  const objects: Array<{ json: string; start: number; end: number }> = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push({ json: text.slice(start, index + 1), start, end: index + 1 });
        start = -1;
      }
    }
  }

  return objects;
}

function extractAllBalancedJsonObjects(text: string): Array<{ json: string; start: number; end: number }> {
  const objects: Array<{ json: string; start: number; end: number }> = [];
  const starts: number[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      starts.push(index);
      continue;
    }

    if (char === "}") {
      const start = starts.pop();
      if (start !== undefined) {
        objects.push({ json: text.slice(start, index + 1), start, end: index + 1 });
      }
    }
  }

  return objects.sort((a, b) => a.start - b.start || b.end - a.end);
}


function isIgnorableToolEnvelopeWrapper(text: string): boolean {
  return /^[\s|`]*$/.test(text);
}

function textLooksLikeApplyPatchEnvelope(text: string): boolean {
  return /"\s*tool\s*"\s*:\s*"\s*(?:apply_patch|propose_patch|补丁|修改|提交补丁|提出补丁)\s*"/.test(text)
    && /"\s*patches\s*"\s*:/.test(text);
}

function salvagePatchEnvelope(text: string): AgentToolEnvelope | null {
  if (!textLooksLikeApplyPatchEnvelope(text)) return null;

  const patches: z.infer<typeof patchSchema>[] = [];
  for (const candidate of extractAllBalancedJsonObjects(text)) {
    if (!candidate.json.includes('"path"') || !candidate.json.includes('"newContent"')) continue;
    try {
      const patch = patchSchema.parse(JSON.parse(candidate.json));
      patches.push(patch);
      if (patches.length >= MAX_PATCHES_PER_TOOL_CALL) break;
    } catch {
      // Keep scanning; a truncated later patch should not discard complete earlier patches.
    }
  }

  if (patches.length === 0) return null;
  return {
    tool: "apply_patch",
    params: { patches },
  };
}

export function parseToolEnvelopes(text: string): ToolEnvelopeParseResult {
  const envelopes: AgentToolEnvelope[] = [];
  const errors: string[] = [];
  const parsedCandidates = new Set<string>();

  const parseCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized || parsedCandidates.has(normalized)) return;
    parsedCandidates.add(normalized);
    try {
      envelopes.push(parseEnvelopeLine(normalized));
    } catch (error) {
      errors.push(humanizeParseError(error, normalized));
    }
  };

  const trimmedText = text.trim();
  if (trimmedText.startsWith("{") && trimmedText.endsWith("}")) {
    parseCandidate(trimmedText);
  }

  for (const match of text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    const block = match[1]?.trim();
    if (block?.startsWith("{") && block.endsWith("}")) {
      parseCandidate(block);
    }
  }

  if (envelopes.length === 0) {
    const candidates = extractBalancedJsonObjects(text).filter(candidate => candidate.json.includes('"tool"'));
    if (candidates.length === 1) {
      const candidate = candidates[0];
      const before = text.slice(0, candidate.start);
      const after = text.slice(candidate.end);
      if (isIgnorableToolEnvelopeWrapper(before) && isIgnorableToolEnvelopeWrapper(after)) {
        parseCandidate(candidate.json);
      }
    }
  }

  if (envelopes.length === 0) {
    const salvagedPatch = salvagePatchEnvelope(text);
    if (salvagedPatch) {
      envelopes.push(salvagedPatch);
      errors.length = 0;
    }
  }

  const textWithoutFences = text.replace(/```(?:json|JSON)?\s*([\s\S]*?)```/g, "\n");
  if (envelopes.length === 0) {
    for (const rawLine of textWithoutFences.split(/\n+/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("```")) continue;
      if (!line.startsWith("{") || !line.endsWith("}")) {
        if (line.includes('"tool"')) {
          if (line.startsWith("{")) {
            errors.push(humanizeParseError(new Error("JSON Parse error: incomplete tool object"), line));
          } else {
            errors.push("Tool calls must be strict JSON with no prose around the JSON object.");
          }
        }
        continue;
      }
      parseCandidate(line);
    }
  }

  if (envelopes.length === 0 && looksLikeNonStrictPatchProposal(text)) {
    errors.push(`Patch proposals must use a strict propose_patch tool envelope with at most ${MAX_PATCHES_PER_TOOL_CALL} files: {"tool":"propose_patch","params":{"patches":[{"path":"relative/file","oldContent":"...","newContent":"..."}]}}`);
  }

  return { envelopes, errors };
}
