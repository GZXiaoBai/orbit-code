import { normalizeCommandWithCwd, type NormalizedCommand } from "./commandParser";

export interface VerificationCommandInput {
  planCommands?: string[];
  cwd?: string;
  packageScripts?: Record<string, string>;
}

function splitCommandCandidates(command: string): string[] {
  return command
    .split(/\s+&&\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isInstallOnlyCommand(command: NormalizedCommand): boolean {
  const executable = command.command.toLowerCase();
  const args = command.args.map((arg) => arg.toLowerCase());
  if (executable === "npm") return args[0] === "install" || args[0] === "i";
  if (executable === "pnpm" || executable === "yarn" || executable === "bun") {
    return args.length === 0 || args[0] === "install" || args[0] === "i";
  }
  return false;
}

function scoreVerificationCommand(command: NormalizedCommand): number {
  const text = [command.command, ...command.args].join(" ").toLowerCase();
  if (isInstallOnlyCommand(command)) return -20;
  if (/\b(test|vitest|jest|node:test)\b/.test(text)) return 50;
  if (/\b(typecheck|tsc|lint)\b/.test(text)) return 40;
  if (/\bbuild\b/.test(text)) return 30;
  if (/\bpreview|dev|serve\b/.test(text)) return -10;
  return 10;
}

function commandFromScripts(scripts: Record<string, string> | undefined, cwd?: string): NormalizedCommand | null {
  if (!scripts) return null;
  if (scripts["test:run"]) return { command: "npm", args: ["run", "test:run"], ...(cwd ? { cwd } : {}) };
  if (scripts.test) {
    const testScript = scripts.test.toLowerCase();
    if (testScript.includes("vitest")) return { command: "npm", args: ["test", "--", "--run"], ...(cwd ? { cwd } : {}) };
    return { command: "npm", args: ["test"], ...(cwd ? { cwd } : {}) };
  }
  if (scripts.typecheck) return { command: "npm", args: ["run", "typecheck"], ...(cwd ? { cwd } : {}) };
  if (scripts.build) return { command: "npm", args: ["run", "build"], ...(cwd ? { cwd } : {}) };
  return null;
}

export function selectVerificationCommand(input: VerificationCommandInput): NormalizedCommand | null {
  const planCandidates = (input.planCommands || [])
    .flatMap(splitCommandCandidates)
    .map((command) => normalizeCommandWithCwd(command, input.cwd))
    .filter((command): command is NormalizedCommand => Boolean(command));

  const scriptCommand = commandFromScripts(input.packageScripts, input.cwd);
  const candidates = [...planCandidates, ...(scriptCommand ? [scriptCommand] : [])];
  if (candidates.length === 0) return null;

  return candidates
    .map((command, index) => ({ command, index, score: scoreVerificationCommand(command) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.command || null;
}
