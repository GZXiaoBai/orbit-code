import { describe, expect, it } from "vitest";
import {
  approvalGrantKey,
  createApprovalRequest,
  persistableApprovalGrants,
  recoverApprovalGrants,
  recoverApprovalRequests,
  resolveApprovalRequest,
  updateApprovalGrantScope,
  type ApprovalGrant,
} from "../state/useApprovalQueue";

describe("approval queue reducers", () => {
  it("creates pending command approval requests", () => {
    const request = createApprovalRequest("run_command", {
      command: "npm",
      args: ["test", "--", "--run"],
      reason: "verify frontend",
    }, "verify frontend");

    expect(request.tool).toBe("run_command");
    expect(request.status).toBe("pending");
    expect(request.params.args).toEqual(["test", "--", "--run"]);
  });

  it("resolves approve without mutating unrelated requests", () => {
    const first = createApprovalRequest("run_command", { command: "npm" });
    const second = createApprovalRequest("ask_user", { question: "Continue?" });
    const resolved = resolveApprovalRequest([first, second], first.id, true);

    expect(resolved[0].status).toBe("approved");
    expect(resolved[1].status).toBe("pending");
  });

  it("resolves deny as a stop signal", () => {
    const request = createApprovalRequest("run_command", { command: "rm" });
    const resolved = resolveApprovalRequest([request], request.id, false);

    expect(resolved[0].status).toBe("denied");
    expect(resolved[0].resolvedAt).toBeTruthy();
  });

  it("recovers pending approvals only when the live queue is empty", () => {
    const recovered = createApprovalRequest("run_command", {
      command: "npm",
      args: ["test"],
      reason: "Recovered verification",
    });
    const live = createApprovalRequest("run_command", { command: "cargo" });

    expect(recoverApprovalRequests([], [recovered])).toEqual([recovered]);
    expect(recoverApprovalRequests([live], [recovered])).toEqual([live]);
  });

  it("tracks grant scope on pending approvals", () => {
    const request = createApprovalRequest("run_command", {
      command: "npm",
      args: ["test"],
      workspacePath: "/tmp/project",
      threadId: "thread-1",
    });

    const updated = updateApprovalGrantScope([request], request.id, "session");

    expect(updated[0].grantScope).toBe("session");
  });

  it("builds stable command grant keys without transient scope fields", () => {
    const first = approvalGrantKey("run_command", {
      command: "npm",
      args: ["run", "build"],
      cwd: "orbit-mini-lab",
      workspacePath: "/tmp/a",
      threadId: "thread-a",
      taskId: "task-a",
    });
    const second = approvalGrantKey("run_command", {
      command: "npm",
      args: ["run", "build"],
      cwd: "orbit-mini-lab",
      workspacePath: "/tmp/b",
      threadId: "thread-b",
      taskId: "task-b",
    });

    expect(first).toBe(second);
  });

  it("keeps only scoped grants that can be safely recovered", () => {
    const validProject: ApprovalGrant = {
      id: "project-grant",
      tool: "run_command",
      key: "run_command:npm",
      workspacePath: "/tmp/project",
      scope: "project",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    const validSession: ApprovalGrant = {
      ...validProject,
      id: "session-grant",
      threadId: "thread-1",
      scope: "session",
    };
    const invalidSession: ApprovalGrant = {
      ...validProject,
      id: "invalid-session",
      scope: "session",
    };

    expect(recoverApprovalGrants([validProject, validSession, invalidSession])).toEqual([validProject, validSession]);
    expect(persistableApprovalGrants([validProject, validSession])).toEqual([validProject, validSession]);
  });
});
