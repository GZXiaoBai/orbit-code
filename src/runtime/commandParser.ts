export interface ParsedCommand {
  command: string;
  args: string[];
}

export interface NormalizedCommand {
  command: string;
  args: string[];
  cwd?: string;
}

export function parseCommandLine(input: string): ParsedCommand | null {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += "\\";
  if (current) tokens.push(current);
  if (tokens.length === 0) return null;

  return {
    command: tokens[0],
    args: tokens.slice(1),
  };
}

export function normalizeCommandWithCwd(input: string, preferredCwd?: string): NormalizedCommand | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const cdMatch = trimmed.match(/^cd\s+((?:"[^"]+"|'[^']+'|[^\s&;]+))\s*&&\s*(.+)$/);
  if (cdMatch) {
    const parsedCwd = parseCommandLine(cdMatch[1])?.command;
    const nextCommand = parseCommandLine(cdMatch[2]);
    if (!parsedCwd || !nextCommand) return null;
    return {
      ...nextCommand,
      cwd: preferredCwd && preferredCwd === parsedCwd ? preferredCwd : parsedCwd,
    };
  }

  const parsed = parseCommandLine(trimmed);
  if (!parsed) return null;
  return {
    ...parsed,
    ...(preferredCwd ? { cwd: preferredCwd } : {}),
  };
}

export function formatCommandForDisplay(command: string, args: string[] = []): string {
  return [command, ...args].map((token) => {
    if (!/[\s"'\\]/.test(token)) return token;
    return `"${token.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }).join(" ");
}
