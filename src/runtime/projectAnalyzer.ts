import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/tauri";

export interface ProjectInfo {
  name: string;
  version: string;
  type: "node" | "rust" | "python" | "unknown";
  dependencies: string[];
  devDependencies: string[];
  scripts: Record<string, string>;
  buildTool: string;
  hasTests: boolean;
  tsConfig?: {
    strict: boolean;
    target: string;
    jsx: string;
  };
}

async function readIfExists(path: string, workspacePath: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>("read_workspace_file", { path, workspacePath });
  } catch {
    return null;
  }
}

export async function analyzeProject(workspacePath = ""): Promise<ProjectInfo | null> {
  if (!isTauri()) {
    return null;
  }

  try {
    // Try package.json first
    const pkgRaw = await readIfExists("package.json", workspacePath);
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw);
      const info: ProjectInfo = {
        name: pkg.name || "unknown",
        version: pkg.version || "0.0.0",
        type: "node",
        dependencies: Object.keys(pkg.dependencies || {}),
        devDependencies: Object.keys(pkg.devDependencies || {}),
        scripts: pkg.scripts || {} as Record<string, string>,
        buildTool: pkg.devDependencies?.vite ? "vite" :
                   pkg.devDependencies?.webpack ? "webpack" :
                   pkg.devDependencies?.esbuild ? "esbuild" : "unknown",
        hasTests: !!(
          pkg.scripts?.test ||
          pkg.devDependencies?.vitest ||
          pkg.devDependencies?.jest
        ),
      };

      // Try tsconfig
      const tsRaw = await readIfExists("tsconfig.json", workspacePath);
      if (tsRaw) {
        const ts = JSON.parse(tsRaw);
        info.tsConfig = {
          strict: ts.compilerOptions?.strict || false,
          target: ts.compilerOptions?.target || "ES2020",
          jsx: ts.compilerOptions?.jsx || "react",
        };
      }

      return info;
    }

    // Try Cargo.toml
    const cargoRaw = await readIfExists("src-tauri/Cargo.toml", workspacePath);
    if (cargoRaw) {
      const deps: string[] = [];
      let inDeps = false;
      for (const line of cargoRaw.split("\n")) {
        if (line.startsWith("[dependencies]")) { inDeps = true; continue; }
        if (line.startsWith("[") && inDeps) { inDeps = false; }
        if (inDeps && !line.startsWith("#") && line.trim()) {
          const name = line.split("=")[0].trim();
          if (name) deps.push(name);
        }
      }

      return {
        name: "rust-project",
        version: "0.1.0",
        type: "rust",
        dependencies: deps,
        devDependencies: [],
        scripts: {},
        buildTool: "cargo",
        hasTests: true,
      };
    }

    // Try requirements.txt / pyproject.toml
    const reqRaw = await readIfExists("requirements.txt", workspacePath);
    if (reqRaw) {
      return {
        name: "python-project",
        version: "0.1.0",
        type: "python",
        dependencies: reqRaw.split("\n").filter(l => l.trim() && !l.startsWith("#")),
        devDependencies: [],
        scripts: {},
        buildTool: "pip",
        hasTests: false,
      };
    }
  } catch (e) {
    console.warn("[ProjectAnalyzer] Failed:", e);
  }

  return null;
}
