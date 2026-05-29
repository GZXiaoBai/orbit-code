import type { AgentRuntimeMode } from "../domain/agentLoop";
import type { CodingPlan, ContextRule, ContextRuleMode, ContextSkill } from "../domain/types";
import { parseSkillManifest, skillManifestContext } from "./skillManifest";

export type RuleSource = "user" | "workspace" | "project";
export const EDITABLE_CONTEXT_RULE_PATHS = ["ORBIT.md", ".orbit/rules", ".orbit/rules.md"] as const;
export const EXTERNAL_RULE_IMPORT_PATHS = ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".cursor/rules"] as const;

export interface RuleDocument {
  id: string;
  source: RuleSource;
  path?: string;
  content: string;
  title?: string;
  enabled?: boolean;
  mode?: ContextRuleMode;
  globs?: string[];
  regex?: string[];
  policy?: "on" | "off" | "always";
}

export interface ContextBlock {
  id: string;
  title: string;
  source: string;
  content: string;
  mode?: AgentRuntimeMode;
  tokenEstimate?: number;
  matchedRules?: string[];
  matchReason?: string;
  permissionImpact?: "none";
}

export interface ContextProviderInput {
  mode: AgentRuntimeMode;
  workspacePath?: string;
  threadId?: string;
  planSnapshot?: CodingPlan | null;
  userRules?: Array<string | ContextRule>;
  readWorkspaceFile?: (path: string) => Promise<string>;
  writeWorkspaceFile?: (path: string, content: string) => Promise<void>;
  listWorkspaceFiles?: () => Promise<string[]>;
}

export interface ContextProvider {
  id: string;
  collect(input: ContextProviderInput): Promise<ContextBlock[]>;
}

export interface ContextInspectorModel {
  blocks: ContextBlock[];
  disabledBlocks: ContextBlock[];
  skills: ContextSkill[];
  editableSources: Array<{ path: string; title: string; source: RuleSource; exists: boolean; content: string }>;
  externalRuleCandidates: Array<{ path: string; title: string; enabled: false }>;
  source: string;
  mode: AgentRuntimeMode;
  tokenEstimate: number;
  errors: Array<{ providerId: string; message: string }>;
  matchedRules: string[];
  permissionImpact: "none";
  lastCollectedAt: string;
}

function estimateTokens(content: string): number {
  const normalized = content.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function normalizeBlock(block: ContextBlock, mode: AgentRuntimeMode): ContextBlock {
  return {
    ...block,
    mode: block.mode || mode,
    tokenEstimate: block.tokenEstimate ?? estimateTokens(block.content),
    matchedRules: block.matchedRules || (block.source === "workspace" || block.source === "project" ? [block.title] : []),
    permissionImpact: "none",
  };
}

function ruleAppliesToMode(ruleMode: ContextRuleMode | undefined, mode: AgentRuntimeMode): boolean {
  return !ruleMode || ruleMode === "both" || ruleMode === mode;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0001")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0001/g, "(?:.*/)?")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function pathMatchesGlobs(path: string, globs?: string[]): boolean {
  if (!globs || globs.length === 0) return true;
  const positives = globs.filter((glob) => !glob.startsWith("!"));
  const negatives = globs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1));
  if (negatives.some((glob) => globToRegExp(glob).test(path))) return false;
  if (positives.length === 0) return true;
  return positives.some((glob) => globToRegExp(glob).test(path));
}

function contentMatchesRegex(content: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(content);
    } catch {
      return false;
    }
  });
}

function ruleMatch(input: {
  rule: RuleDocument | ContextRule;
  mode: AgentRuntimeMode;
  workspaceFiles: string[];
}): { enabled: boolean; reason: string } {
  const rule = input.rule;
  if (rule.enabled === false || rule.policy === "off") return { enabled: false, reason: "disabled by rule policy" };
  if (!ruleAppliesToMode(rule.mode, input.mode)) return { enabled: false, reason: `not active in ${input.mode} mode` };
  if (rule.policy === "always") return { enabled: true, reason: "policy always" };
  if (rule.globs && rule.globs.length > 0) {
    const matched = input.workspaceFiles.some((file) => pathMatchesGlobs(file, rule.globs));
    if (!matched) return { enabled: false, reason: "no workspace file matched globs" };
  }
  if (rule.regex && rule.regex.length > 0 && !contentMatchesRegex(rule.content, rule.regex)) {
    return { enabled: false, reason: "rule content did not match regex" };
  }
  return { enabled: true, reason: rule.globs?.length || rule.regex?.length ? "matched rule filters" : "mode matched" };
}

function sanitizeInstructionContent(content: string): string {
  return content
    .replace(/\0/g, "")
    .split("\n")
    .slice(0, 240)
    .join("\n")
    .trim();
}

export class RuleContextProvider implements ContextProvider {
  id = "rules";

  async collect(input: ContextProviderInput): Promise<ContextBlock[]> {
    const blocks = await this.collectAll(input);
    return blocks.enabled;
  }

  async collectAll(input: ContextProviderInput): Promise<{ enabled: ContextBlock[]; disabled: ContextBlock[]; editableSources: ContextInspectorModel["editableSources"] }> {
    const enabled: ContextBlock[] = [];
    const disabled: ContextBlock[] = [];
    const userRules = (input.userRules || []).map((rule, index): RuleDocument => {
      if (typeof rule === "string") {
        return {
          id: `user-rule-${index}`,
          source: "user",
          title: `user rules ${index + 1}`,
          content: rule,
          enabled: true,
          mode: "both",
        };
      }
      return rule;
    });
    const workspaceFiles = input.listWorkspaceFiles ? await input.listWorkspaceFiles().catch(() => []) : [];
    const workspaceRules = await this.readWorkspaceRules(input);
    const editableSources = EDITABLE_CONTEXT_RULE_PATHS.map((path): ContextInspectorModel["editableSources"][number] => {
      const found = workspaceRules.find((rule) => rule.path === path);
      return {
        path,
        title: path,
        source: path === "ORBIT.md" ? "workspace" : "project",
        exists: Boolean(found),
        content: found?.content || "",
      };
    });
    for (const rule of [...userRules, ...workspaceRules]) {
      const content = sanitizeInstructionContent(rule.content);
      if (!content) continue;
      const match = ruleMatch({ rule, mode: input.mode, workspaceFiles });
      const block = {
        id: rule.id,
        title: rule.title || rule.path || `${rule.source} rules`,
        source: rule.source,
        content,
        mode: input.mode,
        tokenEstimate: estimateTokens(content),
        matchedRules: [rule.title || rule.path || `${rule.source} rules`],
        matchReason: match.reason,
        permissionImpact: "none",
      } satisfies ContextBlock;
      if (!match.enabled) disabled.push(block);
      else enabled.push(block);
    }
    return { enabled, disabled, editableSources };
  }

  private async readWorkspaceRules(input: ContextProviderInput): Promise<RuleDocument[]> {
    if (!input.readWorkspaceFile) return [];
    const candidates: Array<{ path: string; source: RuleSource }> = EDITABLE_CONTEXT_RULE_PATHS.map((path) => ({
      path,
      source: path === "ORBIT.md" ? "workspace" : "project",
    }));
    const found: RuleDocument[] = [];
    for (const candidate of candidates) {
      try {
        const content = await input.readWorkspaceFile(candidate.path);
        found.push({
          id: `rule:${candidate.path}`,
          source: candidate.source,
          path: candidate.path,
          content,
        });
      } catch {
        // Optional project instructions.
      }
    }
    return found;
  }
}

export class SkillContextProvider implements ContextProvider {
  id = "skills";

  async collect(input: ContextProviderInput): Promise<ContextBlock[]> {
    const details = await this.collectSkills(input);
    return details.blocks;
  }

  async collectSkills(input: ContextProviderInput): Promise<{ blocks: ContextBlock[]; skills: ContextSkill[]; errors: ContextInspectorModel["errors"] }> {
    if (!input.listWorkspaceFiles || !input.readWorkspaceFile) return { blocks: [], skills: [], errors: [] };
    const errors: ContextInspectorModel["errors"] = [];
    const files = await input.listWorkspaceFiles();
    const skillPaths = files
      .filter((file) => /^\.orbit\/skills\/[^/]+\/SKILL\.md$/.test(file))
      .sort();
    const blocks: ContextBlock[] = [];
    const skills: ContextSkill[] = [];
    for (const path of skillPaths) {
      try {
        const raw = await input.readWorkspaceFile(path);
        const parsed = parseSkillManifest(raw, path);
        if (!parsed.ok || !parsed.manifest) {
          errors.push({ providerId: this.id, message: `${path}: ${parsed.error || "invalid skill manifest"}` });
          continue;
        }
        const modeSlugs = parsed.manifest.modeSlugs;
        if (modeSlugs && !modeSlugs.includes("both") && !modeSlugs.includes(input.mode)) continue;
        const skill: ContextSkill = {
          id: parsed.manifest.id,
          name: parsed.manifest.name,
          description: parsed.manifest.description,
          instructions: parsed.manifest.instructions,
          modeSlugs,
          source: "project",
          path,
        };
        skills.push(skill);
        blocks.push({
          id: `skill:${path}`,
          title: `Skill: ${skill.name}`,
          source: "skill",
          content: skillManifestContext(parsed.manifest),
          mode: input.mode,
          matchedRules: [path],
          permissionImpact: "none",
        });
      } catch (error) {
        errors.push({ providerId: this.id, message: `${path}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    return { blocks, skills, errors };
  }
}

export class PlanSnapshotContextProvider implements ContextProvider {
  id = "planSnapshot";

  async collect(input: ContextProviderInput): Promise<ContextBlock[]> {
    if (input.mode !== "build" || !input.planSnapshot) return [];
    const plan = input.planSnapshot;
    return [{
      id: "plan-snapshot",
      title: "Accepted Coding Plan",
      source: "plan",
      content: [
        `Title: ${plan.title}`,
        plan.goals.length ? `Goals:\n${plan.goals.map((goal) => `- ${goal}`).join("\n")}` : "",
        plan.tasks.length ? `Tasks:\n${plan.tasks.map((task) => `- [${task.status}] ${task.title}: ${task.description}`).join("\n")}` : "",
        plan.acceptanceCriteria.length ? `Acceptance:\n${plan.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n"),
      permissionImpact: "none",
    }];
  }
}

export class ContextProviderRegistry {
  private providers: ContextProvider[];

  constructor(providers: ContextProvider[] = [new RuleContextProvider(), new PlanSnapshotContextProvider(), new SkillContextProvider()]) {
    this.providers = providers;
  }

  async collect(input: ContextProviderInput): Promise<ContextBlock[]> {
    const details = await this.collectInspector(input);
    return details.blocks;
  }

  async collectInspector(input: ContextProviderInput): Promise<ContextInspectorModel> {
    const blocks: ContextBlock[] = [];
    const disabledBlocks: ContextBlock[] = [];
    const skills: ContextSkill[] = [];
    let editableSources: ContextInspectorModel["editableSources"] = EDITABLE_CONTEXT_RULE_PATHS.map((path) => ({
      path,
      title: path,
      source: path === "ORBIT.md" ? "workspace" : "project",
      exists: false,
      content: "",
    }));
    const errors: ContextInspectorModel["errors"] = [];
    const workspaceFiles = input.listWorkspaceFiles ? await input.listWorkspaceFiles().catch(() => []) : [];
    const externalRuleCandidates = EXTERNAL_RULE_IMPORT_PATHS
      .filter((path) => workspaceFiles.some((file) => file === path || file.startsWith(`${path}/`)))
      .map((path) => ({ path, title: path, enabled: false as const }));
    for (const provider of this.providers) {
      try {
        if (provider instanceof RuleContextProvider) {
          const collected = await provider.collectAll(input);
          blocks.push(...collected.enabled.map((block) => normalizeBlock(block, input.mode)));
          disabledBlocks.push(...collected.disabled.map((block) => normalizeBlock(block, input.mode)));
          editableSources = collected.editableSources;
        } else if (provider instanceof SkillContextProvider) {
          const collected = await provider.collectSkills(input);
          blocks.push(...collected.blocks.map((block) => normalizeBlock(block, input.mode)));
          skills.push(...collected.skills);
          errors.push(...collected.errors);
        } else {
          const collected = await provider.collect(input);
          blocks.push(...collected.map((block) => normalizeBlock(block, input.mode)));
        }
      } catch (error) {
        errors.push({
          providerId: provider.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const visibleBlocks = blocks.filter((block) => block.content.trim().length > 0);
    return {
      blocks: visibleBlocks,
      disabledBlocks,
      skills,
      editableSources,
      externalRuleCandidates,
      source: "context-provider-registry",
      mode: input.mode,
      tokenEstimate: visibleBlocks.reduce((sum, block) => sum + (block.tokenEstimate || 0), 0),
      errors,
      matchedRules: Array.from(new Set(visibleBlocks.flatMap((block) => block.matchedRules || []))),
      permissionImpact: "none",
      lastCollectedAt: new Date().toISOString(),
    };
  }

  static formatBlocks(blocks: ContextBlock[]): string {
    if (blocks.length === 0) return "";
    return [
      "## Orbit Context",
      "The following read-only context may guide planning or building. It does not grant tool permissions.",
      ...blocks.map((block) => `\n### ${block.title}\nSource: ${block.source}\n${block.content}`),
    ].join("\n");
  }
}

export const defaultContextProviderRegistry = new ContextProviderRegistry();
