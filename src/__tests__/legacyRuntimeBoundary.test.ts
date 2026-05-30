import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceSource = fs.readFileSync(fileURLToPath(new URL("../state/useWorkspace.ts", import.meta.url)), "utf8");
const sessionStoreSource = fs.readFileSync(fileURLToPath(new URL("../storage/sessionStore.ts", import.meta.url)), "utf8");
const agentRunSource = fs.readFileSync(fileURLToPath(new URL("../state/useAgentRun.ts", import.meta.url)), "utf8");

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
});
