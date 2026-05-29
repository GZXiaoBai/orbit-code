export type FileActionSurface = "timeline" | "review" | "diff" | "fileTree";
export type FileOpenAction = "vscode" | "cursor" | "default" | "reveal";

export interface FileActionTarget {
  workspacePath: string;
  relativePath: string;
  absolutePath: string;
  sourceSurface: FileActionSurface;
  line?: number;
  column?: number;
}

export interface FileActionTargetInput {
  workspacePath?: string;
  path: string;
  sourceSurface: FileActionSurface;
}

export function parseFileLineColumn(path: string): { path: string; line?: number; column?: number } {
  const match = path.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (!match) return { path };
  return {
    path: match[1],
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : undefined,
  };
}

export function normalizeFileActionPath(path: string): string {
  const withoutFileScheme = path.startsWith("file://")
    ? decodeURIComponent(path.replace(/^file:\/\/+/, "/"))
    : path;
  return withoutFileScheme.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").trim();
}

export function isUnsafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//.test(path)) return true;
  return path.split("/").some((part) => part === "..");
}

export function createFileActionTarget(input: FileActionTargetInput): FileActionTarget | null {
  const workspacePath = normalizeFileActionPath(input.workspacePath || "").replace(/\/+$/, "");
  if (!workspacePath) return null;

  const parsed = parseFileLineColumn(normalizeFileActionPath(input.path));
  let relativePath = parsed.path;

  if (relativePath.startsWith(`${workspacePath}/`)) {
    relativePath = relativePath.slice(workspacePath.length + 1);
  }

  relativePath = relativePath.replace(/^\/+/, "");
  if (isUnsafeRelativePath(relativePath)) return null;

  return {
    workspacePath,
    relativePath,
    absolutePath: `${workspacePath}/${relativePath}`,
    sourceSurface: input.sourceSurface,
    line: parsed.line,
    column: parsed.column,
  };
}

export function looksLikeFilePath(value: string): boolean {
  const clean = normalizeFileActionPath(value).trim();
  if (!clean || /\s/.test(clean)) return false;
  return clean.includes("/")
    || /\.(tsx?|jsx?|css|scss|json|ya?ml|md|rs|py|go|java|kt|swift|html|vue|svelte|toml|lock)$/i.test(clean);
}
