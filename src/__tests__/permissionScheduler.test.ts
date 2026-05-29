import { describe, expect, it, vi } from "vitest";
import { PermissionScheduler } from "../runtime/permissionScheduler";

describe("PermissionScheduler", () => {
  it("denies Plan-mode command without enqueueing UI approval", async () => {
    const enqueueApproval = vi.fn();
    const scheduler = new PermissionScheduler({ enqueueApproval });

    const result = await scheduler.request({
      mode: "plan",
      tool: "run_command",
      params: { command: "npm", args: ["test"] },
    });

    expect(result.approved).toBe(false);
    expect(result.policy.decision).toBe("deny");
    expect(result.toolResult).toContain("Denied run_command");
    expect(enqueueApproval).not.toHaveBeenCalled();
  });

  it("routes Build command approval through the adapter", async () => {
    const enqueueApproval = vi.fn(async (_tool, _params, _reason, onCreated) => {
      onCreated?.({
        id: "approval-1",
        tool: "run_command",
        params: { command: "npm" },
        reason: "verify",
        grantScope: "once",
        status: "pending",
        createdAt: "2026-05-29T00:00:00.000Z",
      });
      return true;
    });
    const scheduler = new PermissionScheduler({ enqueueApproval });

    const result = await scheduler.request({
      mode: "build",
      tool: "run_command",
      params: { command: "npm", args: ["test"], reason: "verify" },
      reason: "verify",
      runSessionId: "run-1",
      toolCallId: "tool-1",
    });

    expect(enqueueApproval).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(true);
    expect(result.action.id).toBe("approval-1");
    expect(result.action).toMatchObject({ runSessionId: "run-1", toolCallId: "tool-1" });
    expect(result.toolResult).toContain("Approved run_command");
  });

  it("emits pending and resolved ActionRequired records around UI approval", async () => {
    const created = vi.fn();
    const resolved = vi.fn();
    const scheduler = new PermissionScheduler({
      enqueueApproval: vi.fn(async (_tool, _params, _reason, onCreated) => {
        onCreated?.({
          id: "approval-action-1",
          tool: "run_command",
          params: { command: "npm", args: ["install"] },
          reason: "install deps",
          grantScope: "once",
          status: "pending",
          createdAt: "2026-05-29T00:00:00.000Z",
        });
        return false;
      }),
    });

    const result = await scheduler.request({
      mode: "build",
      tool: "run_command",
      params: { command: "npm", args: ["install"], reason: "install deps" },
      onActionCreated: created,
      onActionResolved: resolved,
    });

    expect(created).toHaveBeenCalledWith(expect.objectContaining({
      id: "approval-action-1",
      status: "pending",
      resumeAction: { type: "approval", payloadId: "approval-action-1" },
    }), expect.anything());
    expect(resolved).toHaveBeenCalledWith(expect.objectContaining({
      id: "approval-action-1",
      status: "denied",
    }), expect.anything());
    expect(result.toolResult).toContain("Denied run_command");
  });

  it("classifies install and network commands as dedicated blocking action kinds", async () => {
    const created = vi.fn();
    const scheduler = new PermissionScheduler({
      enqueueApproval: vi.fn(async (_tool, _params, _reason, onCreated) => {
        onCreated?.({
          id: "approval-install",
          tool: "run_command",
          params: { command: "npm", args: ["install"] },
          reason: "install deps",
          grantScope: "once",
          status: "pending",
          createdAt: "2026-05-29T00:00:00.000Z",
        });
        return false;
      }),
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
      enqueueApproval: vi.fn(async (_tool, _params, _reason, onCreated) => {
        onCreated?.({
          id: "approval-network",
          tool: "run_command",
          params: { command: "curl", args: ["https://example.com/install.sh"] },
          reason: "fetch remote",
          grantScope: "once",
          status: "pending",
          createdAt: "2026-05-29T00:00:00.000Z",
        });
        return false;
      }),
    });

    await networkScheduler.request({
      mode: "build",
      tool: "run_command",
      params: { command: "curl", args: ["https://example.com/install.sh"], reason: "fetch remote" },
      onActionCreated: networkCreated,
    });

    expect(networkCreated).toHaveBeenCalledWith(expect.objectContaining({ kind: "network" }), expect.anything());
  });
});
