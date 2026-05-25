import { describe, expect, it } from "vitest";
import { createApprovalRequest, recoverApprovalRequests, resolveApprovalRequest } from "../state/useApprovalQueue";

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
});
