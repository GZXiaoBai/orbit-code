import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceSource = fs.readFileSync(fileURLToPath(new URL("../state/useWorkspace.ts", import.meta.url)), "utf8");
const sessionStoreSource = fs.readFileSync(fileURLToPath(new URL("../storage/sessionStore.ts", import.meta.url)), "utf8");
const agentRunSource = fs.readFileSync(fileURLToPath(new URL("../state/useAgentRun.ts", import.meta.url)), "utf8");
const agentTurnRunnerSource = fs.readFileSync(fileURLToPath(new URL("../state/agentTurnRunner.ts", import.meta.url)), "utf8");
const agentLoopEngineSource = fs.readFileSync(fileURLToPath(new URL("../state/agentLoopEngine.ts", import.meta.url)), "utf8");

describe("legacy runtime boundary", () => {
  it("does not expose legacy approval/question queues as main workspace props", () => {
    expect(workspaceSource).not.toContain("pendingApprovals: []");
    expect(workspaceSource).not.toContain("pendingQuestions: []");
    expect(workspaceSource).toContain("legacyQueuesForMigrationOnly");
    expect(workspaceSource.match(/approvalRequests: \[\]/g)).toHaveLength(1);
    expect(workspaceSource.match(/questionRequests: \[\]/g)).toHaveLength(1);
  });

  it("keeps legacy session fields documented as load-only compatibility fields", () => {
    expect(sessionStoreSource).toContain("runtimeLedgerSnapshot?: ThreadRuntimeSnapshot");
    expect(sessionStoreSource).toContain("approvalRequests?: ApprovalRequest[]");
    expect(sessionStoreSource).toContain("questionRequests?: QuestionRequest[]");
  });

  it("keeps Build-turn selection and provider guards in the non-React run kernel", () => {
    expect(agentRunSource).toContain("prepareBuildTurn");
    expect(agentRunSource).toContain("new AgentTurnRunner");
    expect(agentRunSource).not.toContain("new BuildAgentEngine");
    expect(agentRunSource).not.toContain("findProvider(");
    expect(agentRunSource).not.toContain("当前没有可用模型。请先在设置中选择服务商");
  });

  it("keeps approval/question/patch/terminal tool branches out of the React run adapter", () => {
    expect(agentRunSource).toContain("new BuildTurnRuntime");
    expect(agentRunSource).not.toContain("onRequestApproval: async");
    expect(agentRunSource).not.toContain("onAskUser: async");
    expect(agentRunSource).not.toContain("onPatchProposed: async");
    expect(agentRunSource).not.toContain("recordTerminalResult({");
  });

  it("routes the Build tool loop through AgentTurnRunner and ToolLoopController", () => {
    expect(agentTurnRunnerSource).toContain("new ToolLoopController");
    expect(agentTurnRunnerSource).not.toContain("new AgentLoopEngine");
    expect(agentLoopEngineSource).toContain("new ToolLoopController");
    expect(agentLoopEngineSource).not.toContain("while (");
    expect(agentLoopEngineSource).not.toContain("callLLMApiStreaming");
  });
});
