export interface FilePreviewState {
  path?: string;
  content?: string;
  language?: string;
  largeFileMode: boolean;
  loading: boolean;
  error?: string;
  lineCount: number;
}

const maxPreviewBytes = 1024 * 1024;
const maxPreviewLines = 20_000;

const languageByExtension: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  dart: "dart",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  toml: "toml",
  xml: "xml",
  sql: "sql",
};

export function languageFromPath(path?: string | null): string {
  if (!path) return "plaintext";
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return languageByExtension[extension] || "plaintext";
}

export function isLargePreview(content: string): boolean {
  return new Blob([content]).size > maxPreviewBytes || content.split("\n").length > maxPreviewLines;
}

export function buildFilePreviewState(path: string | null, content: string | null): FilePreviewState {
  if (!path) {
    return {
      largeFileMode: false,
      loading: false,
      lineCount: 0,
    };
  }

  if (content === null) {
    return {
      path,
      language: languageFromPath(path),
      largeFileMode: false,
      loading: true,
      lineCount: 0,
    };
  }

  const lineCount = content.split("\n").length;
  return {
    path,
    content,
    language: languageFromPath(path),
    largeFileMode: isLargePreview(content),
    loading: false,
    lineCount,
  };
}
