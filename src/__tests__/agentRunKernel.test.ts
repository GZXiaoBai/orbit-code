import { describe, expect, it } from "vitest";
import { AgentRunKernel, shouldForceFinalSummaryRun } from "../state/agentRunKernel";
import type { RunControlsState } from "../state/useRunControls";
import type { SessionState } from "../state/useSession";

function runControls(overrides: Partial<RunControlsState> = {}): RunControlsState {
  return {
    mode: "build",
    selection: {
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      reasoningEffort: "balanced",
    },
    buildSupported: true,
    missingCredential: false,
    ...overrides,
  } as RunControlsState;
}

function providerSettings(): SessionState["providerSettings"] {
  return {
    activeProviderId: "deepseek",
    configs: {},
    sandboxMode: "none",
    agent: {
      maxIterations: 5,
      contextBudget: "balanced",
      autoCompact: true,
      autoSelfHeal: true,
      verificationApproval: true,
      fixtureProviderEnabled: true,
    },
  };
}

describe("AgentRunKernel", () => {
  it("guards Build execution when UI mode is Plan", () => {
    const result = new AgentRunKernel().prepareBuildTurn({
      importedPlan: null,
      providerSettings: providerSettings(),
      apiKeys: {},
      runControls: runControls({ mode: "plan" }),
      agentRunSession: {
        id: "run-1",
        taskId: null,
        phase: "idle",
        patchProposalIds: [],
        terminalRunIds: [],
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
      workspaceRoot: "/tmp/project",
      threadId: "thread-1",
    });

    expect(result).toEqual({
      ok: false,
      guard: expect.objectContaining({ message: expect.stringContaining("Plan 模式") }),
    });
  });

  it("prepares a Build turn without React state", () => {
    const result = new AgentRunKernel().prepareBuildTurn({
      importedPlan: {
        plan: {
          version: "1",
          title: "Orbit",
          goals: ["test"],
          constraints: [],
          tasks: [
            {
              id: "task-1",
              title: "Implement",
              description: "Do work",
              status: "queued",
              dependsOn: [],
              filesHint: [],
              verification: [],
            },
          ],
          acceptanceCriteria: [],
          risks: [],
          references: [],
        },
        fileName: "plan.yaml",
        importedAt: "2026-05-29T00:00:00.000Z",
      },
      providerSettings: providerSettings(),
      apiKeys: { deepseek: "key" },
      runControls: runControls(),
      agentRunSession: {
        id: "run-1",
        taskId: null,
        phase: "idle",
        patchProposalIds: [],
        terminalRunIds: [],
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
      workspaceRoot: "/tmp/project",
      threadId: "thread-1",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        providerId: "deepseek",
        model: "deepseek-v4-flash",
        runThreadId: "thread-1",
        isResumeRun: false,
        finalSummaryOnly: false,
      },
    });
  });

  it("forces summary-only runs after successful verification unless user provided Build follow-up", () => {
    expect(shouldForceFinalSummaryRun({
      completionOnly: false,
      lastToolResult: "Verification command passed with exit code 0.",
    })).toBe(true);

    expect(shouldForceFinalSummaryRun({
      completionOnly: true,
      resumeContext: "User follow-up instruction in Build mode:\nplease adjust one thing",
    })).toBe(false);
  });
});
