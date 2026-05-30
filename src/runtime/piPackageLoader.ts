export type PiPackageResourceKind = "extension" | "skill" | "prompt" | "theme";
export type PiPackageSourceKind = "npm" | "git" | "local";

export interface PiPackageSource {
  source: string;
  kind?: PiPackageSourceKind;
  packageJson?: Record<string, unknown> | null;
  files?: string[];
  enabled?: boolean;
  filters?: Partial<Record<`${PiPackageResourceKind}s`, string[]>>;
}

export interface PiPackageResource {
  id: string;
  kind: PiPackageResourceKind;
  path: string;
  source: string;
  enabled: boolean;
  executable: boolean;
  sdkCompatible: boolean;
  orbitSupported: boolean;
  blockedReason?: string;
}

export interface PackageResourceManifest {
  source: string;
  kind: PiPackageSourceKind;
  resources: PiPackageResource[];
  diagnostics: Array<{ level: "warning" | "error"; message: string; path?: string }>;
}

type PiManifest = Partial<Record<`${PiPackageResourceKind}s`, unknown>>;

export class PiPackageLoader {
  scan(source: PiPackageSource | string): PackageResourceManifest {
    const input = typeof source === "string" ? { source } : source;
    const files = input.files || [];
    const piManifest = normalizePiManifest(input.packageJson?.pi);
    const diagnostics: PackageResourceManifest["diagnostics"] = [];
    const resources: PiPackageResource[] = [];

    for (const kind of ["extension", "skill", "prompt", "theme"] as const) {
      const manifestKey = `${kind}s` as const;
      const entries = piManifest[manifestKey];
      const discovered = entries
        ? resolveManifestEntries(entries, files, diagnostics)
        : discoverConventionResources(kind, files);
      const filtered = applyResourceFilters(discovered, input.filters?.[manifestKey]);
      for (const path of filtered) {
        resources.push({
          id: `${input.source}:${kind}:${path}`,
          kind,
          path,
          source: input.source,
          enabled: input.enabled !== false,
          executable: kind === "extension",
          sdkCompatible: true,
          orbitSupported: kind !== "extension",
          blockedReason: kind === "extension"
            ? "Pi extensions are executable and require an Orbit extension host before they can run."
            : undefined,
        });
      }
    }

    return {
      source: input.source,
      kind: input.kind || inferSourceKind(input.source),
      resources,
      diagnostics,
    };
  }

  install(source: PiPackageSource | string) {
    const sourceText = typeof source === "string" ? source : source.source;
    return {
      kind: "install" as const,
      title: "Install Pi package",
      description: `Install ${sourceText} into Orbit-managed package storage.`,
      tool: "install_pi_package",
      params: { source: sourceText },
    };
  }

  enableResource(resource: PiPackageResource): PiPackageResource {
    return { ...resource, enabled: true };
  }

  disableResource(resource: PiPackageResource): PiPackageResource {
    return { ...resource, enabled: false };
  }
}

function normalizePiManifest(value: unknown): PiManifest {
  return value && typeof value === "object" ? value as PiManifest : {};
}

function resolveManifestEntries(
  entries: unknown,
  files: string[],
  diagnostics: PackageResourceManifest["diagnostics"],
): string[] {
  if (!Array.isArray(entries)) return [];
  const out = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    if (entry.startsWith("!")) {
      for (const matched of matchPattern(entry.slice(1), files)) out.delete(matched);
      continue;
    }
    const matches = matchPattern(entry.replace(/^[+-]/, ""), files);
    if (matches.length === 0) {
      diagnostics.push({ level: "warning", message: `Package resource path did not match files: ${entry}`, path: entry });
      out.add(entry.replace(/^[+-]/, ""));
      continue;
    }
    for (const matched of matches) out.add(matched);
  }
  return [...out].sort();
}

function discoverConventionResources(kind: PiPackageResourceKind, files: string[]): string[] {
  if (kind === "extension") {
    return files.filter((file) =>
      /^extensions\/[^/]+\.[tj]s$/.test(file) || /^extensions\/[^/]+\/index\.[tj]s$/.test(file)
    ).sort();
  }
  if (kind === "skill") {
    return files.filter((file) => file.startsWith("skills/") && (file.endsWith("/SKILL.md") || /^[^/]+\.md$/.test(file.slice("skills/".length)))).sort();
  }
  if (kind === "prompt") {
    return files.filter((file) => /^prompts\/.+\.md$/.test(file)).sort();
  }
  return files.filter((file) => /^themes\/.+\.json$/.test(file)).sort();
}

function applyResourceFilters(paths: string[], filters?: string[]): string[] {
  if (filters === undefined) return paths;
  if (filters.length === 0) return [];
  let selected = new Set(paths);
  for (const filter of filters) {
    if (filter.startsWith("!")) {
      for (const matched of matchPattern(filter.slice(1), paths)) selected.delete(matched);
    } else if (filter.startsWith("-")) {
      selected.delete(filter.slice(1));
    } else if (filter.startsWith("+")) {
      selected.add(filter.slice(1));
    } else {
      selected = new Set(matchPattern(filter, paths));
    }
  }
  return [...selected].sort();
}

function matchPattern(pattern: string, files: string[]): string[] {
  if (!pattern.includes("*")) return files.includes(pattern) ? [pattern] : [];
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${escaped}$`);
  return files.filter((file) => regex.test(file));
}

function inferSourceKind(source: string): PiPackageSourceKind {
  if (source.startsWith("npm:")) return "npm";
  if (source.startsWith("git:") || /^https?:\/\/|^ssh:\/\//.test(source)) return "git";
  return "local";
}
