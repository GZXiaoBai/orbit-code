import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("runtime ThreadEvent seams", () => {
  it("keeps agent run runtime off the legacy AgentEvent array setter", () => {
    const file = source("src/state/useAgentRun.ts");
    expect(file).not.toContain("setAgentEvents");
    expect(file).toContain("emitThreadEvent");
    expect(file).toContain("updateThreadEvent");
  });

  it("keeps patch workflow updates on typed ThreadEvent events", () => {
    const file = source("src/state/usePatchWorkflow.ts");
    expect(file).not.toContain("setAgentEvents");
    expect(file).not.toContain("agentEventsRef");
    expect(file).toContain("threadEventsRef");
    expect(file).toContain("updateThreadEvent");
  });
});
