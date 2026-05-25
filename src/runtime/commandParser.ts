export interface ParsedCommand {
  command: string;
  args: string[];
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

export function formatCommandForDisplay(command: string, args: string[] = []): string {
  return [command, ...args].map((token) => {
    if (!/[\s"'\\]/.test(token)) return token;
    return `"${token.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }).join(" ");
}
