import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe("Codex runtime boundary", () => {
  it("keeps deleted legacy Agent runtime modules out of production source", () => {
    const forbidden = [
      "agentLoopEngine",
      "ToolLoopController",
      "BuildTurnRuntime",
      "AgentTurnRunner",
      "ToolCallExecutor",
      "PiAgentKernel",
      "PiToolExecutor",
      "useApprovalQueue",
      "legacyQueuesForMigrationOnly",
      "parseToolEnvelopes",
    ];
    const haystack = walk(root)
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    for (const token of forbidden) {
      expect(haystack).not.toContain(token);
    }
  });
});
