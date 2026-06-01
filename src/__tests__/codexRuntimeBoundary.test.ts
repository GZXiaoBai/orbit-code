import { describe, expect, it } from "vitest";

const sourceModules = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function productionSource(): string {
  return Object.entries(sourceModules)
    .filter(([file]) => !file.includes("/__tests__/") && !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    .map(([, source]) => source)
    .join("\n");
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
    const haystack = productionSource();
    for (const token of forbidden) {
      expect(haystack).not.toContain(token);
    }
  });
});
