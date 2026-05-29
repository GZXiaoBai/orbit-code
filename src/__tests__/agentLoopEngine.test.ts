import { describe, it, expect } from "vitest";
import { AgentLoopEngine, doneSummaryClaimsUncreatedPatch, parseToolCallsFromText, stripFabricatedToolResults } from "../state/agentLoopEngine";
import {
  looksLikeSuccessfulVerificationResult,
  selectAgentRunTask,
  shouldForceFinalSummaryRun,
  summarizeAssistantToolOutput,
} from "../state/useAgentRun";

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
  it("flags done summaries that claim patches before a real apply_patch proposal exists", () => {
    expect(doneSummaryClaimsUncreatedPatch("Patch proposal created and waiting for Review Dock.", false)).toBe(true);
    expect(doneSummaryClaimsUncreatedPatch("补丁已经提交审查台，等待审查。", false)).toBe(true);
    expect(doneSummaryClaimsUncreatedPatch("Patch proposal created and waiting for Review Dock.", true)).toBe(false);
    expect(doneSummaryClaimsUncreatedPatch("I read the files and need more context.", false)).toBe(false);
  });

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

  it("reports max-iteration exhaustion as an error instead of silently idling", async () => {
    const phases: string[] = [];
    const errors: string[] = [];

    const engine = new AgentLoopEngine({
      onPhaseChange: (phase) => phases.push(phase),
      onToolCall: () => {},
      onToolResult: () => {},
      onRequestApproval: async () => true,
      getWorkspacePath: () => "",
      getCommandSandboxMode: () => "none",
      getMaxIterations: () => 1,
      getAgentSettings: () => ({ maxIterations: 1, contextBudget: "balanced", autoCompact: true, autoSelfHeal: true, verificationApproval: true, fixtureProviderEnabled: true }),
      onError: (error) => errors.push(error),
      onDone: () => {},
      shouldCancel: () => false,
    });

    const result = await engine.runTask(
      {
        id: "fixture-task",
        title: "Fixture task",
        description: "Exercise iteration cap",
        status: "queued",
        dependsOn: [],
        filesHint: [],
        verification: [],
      },
      "fixture",
      "fixture-coder",
      "fixture://offline",
    );

    expect(result).toContain("Exceeded max iterations");
    expect(errors[0]).toContain("Exceeded max iterations");
    expect(phases).toContain("error");
  });

  it("allows final-summary-only continuation to mention existing patch work without a new patch", async () => {
    const phases: string[] = [];
    const doneSummaries: string[] = [];

    const engine = new AgentLoopEngine({
      onPhaseChange: (phase) => phases.push(phase),
      onToolCall: () => {},
      onToolResult: () => {},
      onRequestApproval: async () => {
        throw new Error("final summary should not request approvals");
      },
      getWorkspacePath: () => "",
      getCommandSandboxMode: () => "none",
      getMaxIterations: () => 3,
      getAgentSettings: () => ({ maxIterations: 3, contextBudget: "balanced", autoCompact: true, autoSelfHeal: true, verificationApproval: true, fixtureProviderEnabled: true }),
      onError: (error) => {
        throw new Error(error);
      },
      onDone: (summary) => doneSummaries.push(summary),
      shouldCancel: () => false,
    });

    const result = await engine.runTask(
      {
        id: "fixture-task",
        title: "Fixture task",
        description: "Summarize verified work",
        status: "verified",
        dependsOn: [],
        filesHint: [],
        verification: [],
      },
      "fixture",
      "fixture-coder",
      "fixture://offline",
      "thread-1",
      undefined,
      "This Orbit run is now a final-summary pass. Verification command finished with exit code 0.",
    );

    expect(result).toContain("Fixture final summary");
    expect(doneSummaries[0]).toContain("patches were applied");
    expect(phases).toContain("done");
    expect(phases).not.toContain("error");
  });
});

describe("Agent event display summaries", () => {
  it("strips model-fabricated tool result blocks before display or continuation", () => {
    const text = [
      "I will inspect the project.",
      "[Tool run_command result]:",
      "workspace: /Users/li/uni/workspace",
      "package.json exists",
      "",
      '{"tool":"list_files","params":{}}',
    ].join("\n");

    expect(stripFabricatedToolResults(text)).toBe([
      "I will inspect the project.",
      '{"tool":"list_files","params":{}}',
    ].join("\n"));
  });

  it("strips XML-style fabricated tool result blocks from DeepSeek prose", () => {
    const text = [
      "<tool_result>",
      "# Tool ran without output or errors",
      "</tool_result>",
      "Let me read the file.",
      '{"tool":"read_file","params":{"path":"src/main.ts"}}',
    ].join("\n");

    expect(stripFabricatedToolResults(text)).toBe([
      "Let me read the file.",
      '{"tool":"read_file","params":{"path":"src/main.ts"}}',
    ].join("\n"));
  });

  it("summarizes tool JSON instead of exposing raw apply_patch payloads", () => {
    const summary = summarizeAssistantToolOutput('{"tool":"apply_patch","params":{"patches":[{"path":"AGENT_GUI_FIXTURE.md","oldContent":"","newContent":"# Fixture"}]}}');
    expect(summary).toBe("Agent 提出补丁审查：1 个文件（AGENT_GUI_FIXTURE.md）");
  });

  it("summarizes command tool calls with command and reason", () => {
    const summary = summarizeAssistantToolOutput('{"tool":"run_command","params":{"command":"npm","args":["test","--","--run"],"reason":"verify changes"}}');
    expect(summary).toBe("Agent 请求运行命令：npm test -- --run。原因：verify changes");
  });
});

describe("Agent run task selection", () => {
  const tasks = [
    {
      id: "task-done",
      title: "Done task",
      description: "Already verified",
      status: "verified" as const,
      dependsOn: [],
      filesHint: [],
      verification: [],
    },
    {
      id: "task-queued",
      title: "Queued task",
      description: "Needs work",
      status: "queued" as const,
      dependsOn: [],
      filesHint: [],
      verification: [],
    },
  ];

  it("prefers pending tasks during normal Build runs", () => {
    expect(selectAgentRunTask({ tasks }).task?.id).toBe("task-queued");
    expect(selectAgentRunTask({ tasks }).completionOnly).toBe(false);
  });

  it("allows completion-summary runs when all tasks are done", () => {
    const doneTasks = tasks.map((task) => ({ ...task, status: "done" as const }));
    const selected = selectAgentRunTask({ tasks: doneTasks, currentTaskId: "task-done" });

    expect(selected.task?.id).toBe("task-done");
    expect(selected.completionOnly).toBe(true);
  });

  it("forces final summary after successful verification resume", () => {
    expect(looksLikeSuccessfulVerificationResult("Verification command for task task-1 finished with exit code 0.")).toBe(true);
    expect(shouldForceFinalSummaryRun({
      completionOnly: false,
      resumeKind: "verification",
      resumeContext: "Verification command for task task-1 finished with exit code 0.",
    })).toBe(true);
  });

  it("does not force final summary for explicit Build follow-up instructions", () => {
    expect(shouldForceFinalSummaryRun({
      completionOnly: true,
      resumeContext: "User follow-up instruction in Build mode:\nAdd one more test",
    })).toBe(false);
  });
});
