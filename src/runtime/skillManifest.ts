export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  instructions: string;
  path?: string;
  modeSlugs?: Array<"plan" | "build" | "both">;
}

export interface SkillManifestParseResult {
  ok: boolean;
  manifest?: SkillManifest;
  error?: string;
}

export function parseSkillManifest(raw: string, path?: string): SkillManifestParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Skill manifest is empty." };

  try {
    const parsed = JSON.parse(trimmed) as Partial<SkillManifest>;
    if (!parsed.id || !parsed.name || !parsed.description) {
      return { ok: false, error: "Skill manifest JSON must include id, name, and description." };
    }
    return {
      ok: true,
      manifest: {
        id: parsed.id,
        name: parsed.name,
        description: parsed.description,
        instructions: parsed.instructions || "",
        path,
        modeSlugs: normalizeModeSlugs(parsed.modeSlugs || (parsed as { mode?: unknown }).mode),
      },
    };
  } catch {
    const frontmatter = parseMarkdownFrontmatter(trimmed);
    const body = frontmatter.body;
    const title = String(frontmatter.data.name || "")
      || body.split("\n").find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim();
    if (!title) return { ok: false, error: "Skill manifest must be JSON or Markdown with a top-level title." };
    return {
      ok: true,
      manifest: {
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name: title,
        description: String(frontmatter.data.description || "")
          || body.split("\n").find((line) => line.trim() && !line.startsWith("#"))?.trim()
          || title,
        instructions: body.trim(),
        path,
        modeSlugs: normalizeModeSlugs(frontmatter.data.modeSlugs || frontmatter.data.mode),
      },
    };
  }
}

function normalizeModeSlugs(input: unknown): Array<"plan" | "build" | "both"> | undefined {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const modes = raw
    .map((item) => String(item).trim().toLowerCase())
    .filter((item): item is "plan" | "build" | "both" => item === "plan" || item === "build" || item === "both");
  return modes.length > 0 ? Array.from(new Set(modes)) : undefined;
}

function parseMarkdownFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---\n")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: raw };
  const yaml = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const data: Record<string, unknown> = {};
  let currentArrayKey = "";
  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("- ") && currentArrayKey) {
      const current = Array.isArray(data[currentArrayKey]) ? data[currentArrayKey] as string[] : [];
      current.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""));
      data[currentArrayKey] = current;
      continue;
    }
    const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    currentArrayKey = "";
    const [, key, value] = match;
    if (!value) {
      data[key] = [];
      currentArrayKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value.slice(1, -1).split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      data[key] = value.trim().replace(/^["']|["']$/g, "");
    }
  }
  return { data, body };
}

export function skillManifestContext(manifest: SkillManifest): string {
  return [
    `Skill: ${manifest.name}`,
    `Description: ${manifest.description}`,
    "This skill is read-only context. It does not grant extra tools or permissions.",
    manifest.instructions ? `Instructions:\n${manifest.instructions}` : "",
  ].filter(Boolean).join("\n\n");
}
