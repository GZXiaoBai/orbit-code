import { describe, expect, it } from "vitest";
import { createPiSdkAdapter } from "../runtime/piSdkAdapter";

describe("PiSdkAdapter", () => {
  it("normalizes stream events into safe runtime message parts", () => {
    const adapter = createPiSdkAdapter();

    expect(adapter.toRuntimeMessagePart({ type: "thinking_delta", delta: "Inspecting files." })).toEqual({
      type: "thinking",
      text: "Inspecting files.",
    });
    expect(adapter.toRuntimeMessagePart({
      type: "toolcall_end",
      toolCallId: "call-1",
      toolName: "propose_patch",
      finalArgs: { patches: [{ path: "src/App.tsx", newContent: "secret" }], reason: "fix" },
    })).toEqual({
      type: "toolCall",
      id: "call-1",
      name: "propose_patch",
      argsSummary: "Arguments: patches, reason",
      finished: true,
    });
    expect(adapter.toRuntimeMessagePart({ type: "done", reason: "stop" })).toMatchObject({ type: "finish", reason: "stop" });
  });

  it("returns model-readable tool results for invalid or unknown tool calls", () => {
    const adapter = createPiSdkAdapter();

    expect(adapter.validateToolCall({ id: "bad", name: "run_command", arguments: "npm test" }, [])).toMatchObject({
      ok: false,
      toolResult: "Tool validation failed: unknown tool run_command.",
    });
    expect(adapter.validateToolCall({ id: "bad", name: "run_command", arguments: "npm test" }, [{ name: "run_command", description: "Run", parameters: {} as any }])).toMatchObject({
      ok: false,
      toolResult: "Tool validation failed for run_command: arguments must be an object.",
    });
  });

  it("keeps direct Pi SDK imports limited to the adapter seam", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = process.cwd();
    const files = await collectSourceFiles(path.join(root, "src"));
    const offenders: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      if (file.endsWith("src/runtime/piSdkAdapter.ts")) continue;
      if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
      if (/@earendil-works\/pi-(ai|agent-core)/.test(source)) offenders.push(path.relative(root, file));
    }
    expect(offenders).toEqual([]);
  });
});

async function collectSourceFiles(dir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(full));
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}
