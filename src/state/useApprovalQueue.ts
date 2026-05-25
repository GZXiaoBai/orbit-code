import { useCallback, useRef, useState } from "react";
import type { ToolParams } from "../domain/agentLoop";

export type ApprovalStatus = "pending" | "approved" | "denied" | "cancelled";

export interface ApprovalRequest {
  id: string;
  tool: string;
  params: ToolParams;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}

export type ApprovalCreatedCallback = (request: ApprovalRequest) => void;

interface PendingResolver {
  resolve: (approved: boolean) => void;
}

export function createApprovalRequest(
  tool: string,
  params: ToolParams,
  reason = ""
): ApprovalRequest {
  return {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tool,
    params,
    reason,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

export function resolveApprovalRequest(
  requests: ApprovalRequest[],
  id: string,
  approved: boolean
): ApprovalRequest[] {
  return requests.map((request) => {
    if (request.id !== id || request.status !== "pending") return request;
    return {
      ...request,
      status: approved ? "approved" : "denied",
      resolvedAt: new Date().toISOString(),
    };
  });
}

export function recoverApprovalRequests(
  current: ApprovalRequest[],
  recovered: ApprovalRequest[],
): ApprovalRequest[] {
  return current.length > 0 ? current : recovered;
}

export function useApprovalQueue(initialRequests: ApprovalRequest[] = []) {
  const [requests, setRequests] = useState<ApprovalRequest[]>(initialRequests);
  const resolversRef = useRef(new Map<string, PendingResolver>());

  const requestApproval = useCallback((
    tool: string,
    params: ToolParams,
    reason = "",
    onCreated?: ApprovalCreatedCallback
  ) => {
    const request = createApprovalRequest(tool, params, reason);
    onCreated?.(request);
    setRequests((prev) => [request, ...prev]);

    return new Promise<boolean>((resolve) => {
      resolversRef.current.set(request.id, { resolve });
    });
  }, []);

  const resolveApproval = useCallback((id: string, approved: boolean) => {
    const resolver = resolversRef.current.get(id);
    if (resolver) {
      resolver.resolve(approved);
      resolversRef.current.delete(id);
    }
    setRequests((prev) => resolveApprovalRequest(prev, id, approved));
    return Boolean(resolver);
  }, []);

  const cancelPendingApprovals = useCallback(() => {
    resolversRef.current.forEach(({ resolve }) => resolve(false));
    resolversRef.current.clear();
    setRequests((prev) =>
      prev.map((request) =>
        request.status === "pending"
          ? { ...request, status: "cancelled", resolvedAt: new Date().toISOString() }
          : request
      )
    );
  }, []);

  const recoverApprovals = useCallback((nextRequests: ApprovalRequest[]) => {
    setRequests((prev) => recoverApprovalRequests(prev, nextRequests));
  }, []);

  return {
    approvalRequests: requests,
    pendingApprovals: requests.filter((request) => request.status === "pending"),
    requestApproval,
    resolveApproval,
    cancelPendingApprovals,
    recoverApprovals,
  };
}
