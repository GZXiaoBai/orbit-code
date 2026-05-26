import { describe, it, expect } from "vitest";
import { AgentLoopEngine, parseToolCallsFromText } from "../state/agentLoopEngine";

describe("AgentLoopEngine — parseToolCalls", () => {
  it("parses strict read_file tool call lines", () => {
    const text = '{"tool": "read_file", "params": {"path": "src/App.tsx"}}';
    const results = parseToolCallsFromText(text);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("read_file");
    expect(results[0].params.path).toBe("src/App.tsx");
  });

  it("rejects tool JSON embedded in prose", () => {
    const text = 'Blah {"tool": "read_file", "params": {"path": "src/App.tsx"}} more text';
    expect(parseToolCallsFromText(text)).toHaveLength(0);
  });

  it("parses done tool call", () => {
    const text = '{"tool": "done", "params": {"summary": "All tasks complete"}}';
    const results = parseToolCallsFromText(text);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("done");
    expect(results[0].params.summary).toBe("All tasks complete");
  });

  it("parses multiple tool calls in one response", () => {
    const text = '{"tool": "search_code", "params": {"query": "useState"}}\n{"tool": "read_file", "params": {"path": "foo.ts"}}';
    const results = parseToolCallsFromText(text);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("parses structured apply_patch arrays", () => {
    const text = '{"tool":"apply_patch","params":{"patches":[{"path":"src/App.tsx","oldContent":"old","newContent":"new"}]}}';
    const results = parseToolCallsFromText(text);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("apply_patch");
    expect(results[0].params.patches).toEqual([
      { path: "src/App.tsx", oldContent: "old", newContent: "new" },
    ]);
  });

  it("returns empty array for text without tool calls", () => {
    const results = parseToolCallsFromText("This is just plain text, no JSON tool calls here.");
    expect(results).toHaveLength(0);
  });

  it("returns empty array for invalid JSON", () => {
    const text = '{"tool": "bad", "params": {broken json}}';
    const results = parseToolCallsFromText(text);
    expect(results).toHaveLength(0);
  });

  it("ignores unknown tools", () => {
    const text = '{"tool": "delete_everything", "params": {"path": "."}}';
    const results = parseToolCallsFromText(text);
    expect(results).toHaveLength(0);
  });
});

describe("AgentLoopEngine — review gates", () => {
  it("stops after proposing a patch instead of calling done before user review", async () => {
    const phases: string[] = [];
    const toolResults: Array<{ id: string; result: string }> = [];
    let doneCalled = false;
    let patchProposals = 0;

    const engine = new AgentLoopEngine({
      onPhaseChange: (phase) => phases.push(phase),
      onToolCall: () => {},
      onToolResult: (id, result) => toolResults.push({ id, result }),
      onRequestApproval: async () => true,
      onPatchProposed: async () => {
        patchProposals += 1;
        return "Patch proposal created and waiting for review.";
      },
      getWorkspacePath: () => "",
      getCommandSandboxMode: () => "none",
      getMaxIterations: () => 8,
      getAgentSettings: () => ({ maxIterations: 8, contextBudget: "balanced", autoCompact: true, autoSelfHeal: true, verificationApproval: true, fixtureProviderEnabled: true }),
      onError: () => {},
      onDone: () => { doneCalled = true; },
      shouldCancel: () => false,
    });

    const result = await engine.runTask(
      {
        id: "fixture-task",
        title: "Fixture task",
        description: "Exercise run command and patch review",
        status: "queued",
        dependsOn: [],
        filesHint: [],
        verification: [],
      },
      "fixture",
      "fixture-coder",
      "fixture://offline",
    );

    expect(result).toContain("waiting for review");
    expect(patchProposals).toBe(1);
    expect(doneCalled).toBe(false);
    expect(phases[phases.length - 1]).toBe("reviewing");
    expect(toolResults.some((entry) => entry.result.includes("waiting for review"))).toBe(true);
  });
});
