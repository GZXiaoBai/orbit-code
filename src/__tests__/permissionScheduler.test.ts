import { describe, expect, it, vi } from "vitest";
import { PermissionScheduler } from "../runtime/permissionScheduler";

describe("PermissionScheduler", () => {
  it("denies Plan-mode command without enqueueing UI approval", async () => {
    const requestAction = vi.fn();
    const scheduler = new PermissionScheduler({ requestAction });

    const result = await scheduler.request({
      mode: "plan",
      tool: "run_command",
      params: { command: "npm", args: ["test"] },
    });

    expect(result.approved).toBe(false);
    expect(result.policy.decision).toBe("deny");
    expect(result.toolResult).toContain("Denied run_command");
    expect(requestAction).not.toHaveBeenCalled();
  });

  it("routes Build command approval through ActionRequired adapter", async () => {
    const requestAction = vi.fn(async (action) => {
      return {
        status: "approved" as const,
        toolResultText: `Approved run_command: ${action.description}`,
        resumeAction: action.resumeAction,
        resolvedAt: "2026-05-29T00:00:01.000Z",
      };
    });
    const scheduler = new PermissionScheduler({ requestAction });

    const result = await scheduler.request({
      mode: "build",
      tool: "run_command",
      params: { command: "npm", args: ["test"], reason: "verify" },
      reason: "verify",
      runSessionId: "run-1",
      toolCallId: "tool-1",
    });

    expect(requestAction).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(true);
    expect(result.action.id).toMatch(/^action-/);
    expect(result.action).toMatchObject({ runSessionId: "run-1", toolCallId: "tool-1" });
    expect(result.toolResult).toContain("Approved run_command");
    expect(result.resolution).toMatchObject({
      status: "approved",
      toolResultText: expect.stringContaining("Approved run_command"),
    });
  });

  it("emits pending and resolved ActionRequired records around UI approval", async () => {
    const created = vi.fn();
    const resolved = vi.fn();
    const scheduler = new PermissionScheduler({
      requestAction: vi.fn(async (action) => ({
        status: "denied" as const,
        toolResultText: `Denied run_command: ${action.description}`,
        resumeAction: action.resumeAction,
        resolvedAt: "2026-05-29T00:00:01.000Z",
      })),
    });

    const result = await scheduler.request({
      mode: "build",
      tool: "run_command",
      params: { command: "npm", args: ["install"], reason: "install deps" },
      onActionCreated: created,
      onActionResolved: resolved,
    });

    expect(created).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending",
      resumeAction: expect.objectContaining({ type: "approval" }),
    }), expect.anything());
    expect(resolved).toHaveBeenCalledWith(expect.objectContaining({
      status: "denied",
      resumeAction: expect.objectContaining({ type: "approval" }),
    }), expect.anything());
    expect(result.toolResult).toContain("Denied run_command");
    expect(result.resolution).toMatchObject({
      status: "denied",
      resumeAction: expect.objectContaining({ type: "approval" }),
    });
  });

  it("classifies install and network commands as dedicated blocking action kinds", async () => {
    const created = vi.fn();
    const scheduler = new PermissionScheduler({
      requestAction: vi.fn(async (action) => ({
        status: "denied" as const,
        toolResultText: `Denied run_command: ${action.description}`,
        resumeAction: action.resumeAction,
      })),
    });

    const install = await scheduler.request({
      mode: "build",
      tool: "run_command",
      params: { command: "npm", args: ["install"], reason: "install deps" },
      onActionCreated: created,
    });

    expect(created).toHaveBeenCalledWith(expect.objectContaining({ kind: "install" }), expect.anything());
    expect(install.action.status).toBe("denied");

    const networkCreated = vi.fn();
    const networkScheduler = new PermissionScheduler({
      requestAction: vi.fn(async (action) => ({
        status: "denied" as const,
        toolResultText: `Denied run_command: ${action.description}`,
        resumeAction: action.resumeAction,
      })),
    });

    await networkScheduler.request({
      mode: "build",
      tool: "run_command",
      params: { command: "curl", args: ["https://example.com/install.sh"], reason: "fetch remote" },
      onActionCreated: networkCreated,
    });

    expect(networkCreated).toHaveBeenCalledWith(expect.objectContaining({ kind: "network" }), expect.anything());
  });

  it("skips UI approval when a matching Build grant exists", async () => {
    const requestAction = vi.fn();
    const scheduler = new PermissionScheduler({ requestAction });

    const result = await scheduler.request({
      mode: "build",
      tool: "run_command",
      params: { command: "npm", args: ["test"] },
      workspacePath: "/tmp/project",
      threadId: "thread-1",
      approvalGrants: [{
        id: "grant-1",
        tool: "run_command",
        key: "run_command:npm\u0000test\u0000",
        workspacePath: "/tmp/project",
        threadId: "thread-1",
        scope: "session",
        mode: "build",
        actions: ["command"],
        createdAt: "2026-05-29T00:00:00.000Z",
      }],
    });

    expect(requestAction).not.toHaveBeenCalled();
    expect(result.approved).toBe(true);
    expect(result.policy.reason).toContain("approval grant");
  });
});
