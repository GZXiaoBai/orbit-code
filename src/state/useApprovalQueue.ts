import { useCallback, useMemo, useRef, useState } from "react";
import type { ToolParams } from "../domain/agentLoop";
import {
  approvalGrantKey,
  persistableApprovalGrants,
  recoverApprovalGrants,
  type ApprovalGrant,
  type ApprovalGrantScope,
} from "../domain/approvalGrant";
export { approvalGrantKey, persistableApprovalGrants, recoverApprovalGrants } from "../domain/approvalGrant";

export type ApprovalStatus = "pending" | "approved" | "denied" | "cancelled";
export type { ApprovalGrant, ApprovalGrantScope } from "../domain/approvalGrant";

export interface ApprovalRequest {
  id: string;
  workspacePath?: string;
  threadId?: string;
  taskId?: string;
  tool: string;
  params: ToolParams;
  reason: string;
  grantScope: ApprovalGrantScope;
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
  reason = "",
  grantScope: ApprovalGrantScope = "once",
): ApprovalRequest {
  const workspacePath = typeof params.workspacePath === "string" ? params.workspacePath : undefined;
  const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
  const taskId = typeof params.taskId === "string" ? params.taskId : undefined;
  return {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspacePath,
    threadId,
    taskId,
    tool,
    params,
    reason,
    grantScope,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

function normalizeApprovalRequest(request: ApprovalRequest): ApprovalRequest {
  return {
    ...request,
    grantScope: request.grantScope || "once",
  };
}

function grantMatchesRequest(grant: ApprovalGrant, request: ApprovalRequest): boolean {
  if (grant.tool !== request.tool || grant.key !== approvalGrantKey(request.tool, request.params)) return false;
  if (grant.scope === "project") {
    return Boolean(grant.workspacePath && request.workspacePath && grant.workspacePath === request.workspacePath);
  }
  return Boolean(
    grant.workspacePath
      && request.workspacePath
      && grant.workspacePath === request.workspacePath
      && grant.threadId
      && request.threadId
      && grant.threadId === request.threadId,
  );
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

export function updateApprovalGrantScope(
  requests: ApprovalRequest[],
  id: string,
  grantScope: ApprovalGrantScope,
): ApprovalRequest[] {
  return requests.map((request) =>
    request.id === id && request.status === "pending"
      ? { ...request, grantScope }
      : request
  );
}

export function recoverApprovalRequests(
  current: ApprovalRequest[],
  recovered: ApprovalRequest[],
): ApprovalRequest[] {
  return current.length > 0 ? current : recovered.map(normalizeApprovalRequest);
}

export function useApprovalQueue(initialRequests: ApprovalRequest[] = [], initialGrants: ApprovalGrant[] = []) {
  const [requests, setRequests] = useState<ApprovalRequest[]>(initialRequests.map(normalizeApprovalRequest));
  const [grants, setGrants] = useState<ApprovalGrant[]>(recoverApprovalGrants(initialGrants));
  const resolversRef = useRef(new Map<string, PendingResolver>());
  const pendingApprovals = useMemo(() => requests.filter((request) => request.status === "pending"), [requests]);
  const approvalGrants = useMemo(() => persistableApprovalGrants(grants), [grants]);

  const requestApproval = useCallback((
    tool: string,
    params: ToolParams,
    reason = "",
    onCreated?: ApprovalCreatedCallback
  ) => {
    const request = createApprovalRequest(tool, params, reason);
    if (grants.some((grant) => grantMatchesRequest(grant, request))) {
      return Promise.resolve(true);
    }

    onCreated?.(request);
    setRequests((prev) => [request, ...prev]);

    return new Promise<boolean>((resolve) => {
      resolversRef.current.set(request.id, { resolve });
    });
  }, [grants]);

  const resolveApproval = useCallback((id: string, approved: boolean) => {
    const request = requests.find((item) => item.id === id);
    const resolver = resolversRef.current.get(id);
    if (resolver) {
      resolver.resolve(approved);
      resolversRef.current.delete(id);
    }
    if (approved && request && (request.grantScope || "once") !== "once") {
      setGrants((prev) => [
        {
          id: `grant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          tool: request.tool,
          key: approvalGrantKey(request.tool, request.params),
          workspacePath: request.workspacePath,
          threadId: request.threadId,
          scope: (request.grantScope || "once") as Exclude<ApprovalGrantScope, "once">,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
    setRequests((prev) => resolveApprovalRequest(prev, id, approved));
    return Boolean(resolver);
  }, [requests]);

  const updateGrantScope = useCallback((id: string, grantScope: ApprovalGrantScope) => {
    setRequests((prev) => updateApprovalGrantScope(prev, id, grantScope));
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

  const recoverApprovals = useCallback((nextRequests: ApprovalRequest[], replace = false) => {
    setRequests((prev) => replace ? nextRequests : recoverApprovalRequests(prev, nextRequests));
  }, []);

  const recoverGrants = useCallback((nextGrants: ApprovalGrant[], replace = false) => {
    setGrants((prev) => replace ? recoverApprovalGrants(nextGrants) : [...recoverApprovalGrants(nextGrants), ...prev]);
  }, []);

  return {
    approvalRequests: requests,
    pendingApprovals,
    requestApproval,
    resolveApproval,
    updateGrantScope,
    cancelPendingApprovals,
    recoverApprovals,
    recoverGrants,
    approvalGrants,
  };
}
