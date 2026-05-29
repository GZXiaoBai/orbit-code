import type { ActionRequiredEvent } from "../domain/actionRequired";
import {
  actionRequiredToolResult,
  createActionRequiredEvent,
  resolveActionRequiredEvent,
} from "../domain/actionRequired";
import type { AgentRuntimeMode, ToolName, ToolParams } from "../domain/agentLoop";
import type { ApprovalCreatedCallback } from "../state/useApprovalQueue";
import type { ApprovalRequest } from "../state/useApprovalQueue";
import type { ProjectSecurityOverride, SecuritySettings } from "../domain/types";
import { defaultPolicyEngine, type PolicyDecision, type PolicyEngine } from "./policyEngine";
import { formatCommandForDisplay } from "./commandParser";

export interface PermissionSchedulerAdapter {
  enqueueApproval: (
    tool: string,
    params: ToolParams,
    reason?: string,
    onCreated?: ApprovalCreatedCallback,
  ) => Promise<boolean>;
}

export interface PermissionSchedulerRequest {
  mode: AgentRuntimeMode;
  tool: ToolName | string;
  params: ToolParams;
  workspacePath?: string;
  threadId?: string;
  taskId?: string;
  runSessionId?: string;
  toolCallId?: string;
  reason?: string;
  security?: SecuritySettings;
  projectOverride?: ProjectSecurityOverride;
  onActionCreated?: (action: ActionRequiredEvent, policy: PolicyDecision) => void;
  onActionResolved?: (action: ActionRequiredEvent, policy: PolicyDecision) => void;
  onCreated?: (request: ApprovalRequest, action: ActionRequiredEvent, policy: PolicyDecision) => void;
}

export interface PermissionSchedulerResult {
  approved: boolean;
  action: ActionRequiredEvent;
  policy: PolicyDecision;
  toolResult: string;
}

function actionKindForTool(tool: string, params: ToolParams): ActionRequiredEvent["kind"] {
  if (tool === "run_command") {
    const command = typeof params.command === "string" ? params.command : "";
    const args = Array.isArray(params.args) ? params.args.filter((arg): arg is string => typeof arg === "string") : [];
    const display = formatCommandForDisplay(command, args);
    if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove)\b/.test(display)) return "install";
    if (/\b(?:curl|wget|ssh|scp|git\s+(?:clone|pull|push|fetch))\b|https?:\/\//i.test(display)) return "network";
    return params.sourceEventId ? "verification" : "command";
  }
  if (tool === "apply_patch" || tool === "propose_patch") return "write";
  return "command";
}

function describeTool(tool: string, params: ToolParams, fallback = ""): string {
  if (tool === "run_command") {
    const command = typeof params.command === "string" ? params.command : "";
    const args = Array.isArray(params.args) ? params.args.filter((arg): arg is string => typeof arg === "string") : [];
    return formatCommandForDisplay(command, args);
  }
  return fallback || tool;
}

export class PermissionScheduler {
  private adapter: PermissionSchedulerAdapter;
  private policyEngine: PolicyEngine;

  constructor(adapter: PermissionSchedulerAdapter, policyEngine = defaultPolicyEngine) {
    this.adapter = adapter;
    this.policyEngine = policyEngine;
  }

  async request(input: PermissionSchedulerRequest): Promise<PermissionSchedulerResult> {
    const policy = this.policyEngine.evaluate({
      mode: input.mode,
      tool: input.tool,
      params: input.params,
      workspacePath: input.workspacePath,
      threadId: input.threadId,
      security: input.security,
      projectOverride: input.projectOverride,
    });
    const action = createActionRequiredEvent({
      kind: actionKindForTool(input.tool, input.params),
      tool: input.tool,
      params: input.params,
      workspacePath: input.workspacePath,
      threadId: input.threadId,
      taskId: input.taskId,
      runSessionId: input.runSessionId,
      toolCallId: input.toolCallId,
      title: input.tool === "run_command" ? "Run command" : `Authorize ${input.tool}`,
      description: describeTool(input.tool, input.params, input.reason),
      reason: input.reason || policy.reason,
    });

    if (policy.decision === "deny") {
      const denied = resolveActionRequiredEvent(action, { approved: false, reason: policy.reason });
      input.onActionCreated?.(action, policy);
      input.onActionResolved?.(denied, policy);
      return {
        approved: false,
        action: denied,
        policy,
        toolResult: actionRequiredToolResult(denied),
      };
    }

    if (policy.decision === "allow" || policy.decision === "sandbox") {
      const approved = resolveActionRequiredEvent(action, { approved: true, reason: policy.reason });
      input.onActionCreated?.(action, policy);
      input.onActionResolved?.(approved, policy);
      return {
        approved: true,
        action: approved,
        policy,
        toolResult: actionRequiredToolResult(approved),
      };
    }

    let createdRequest: ApprovalRequest | undefined;
    const approved = await this.adapter.enqueueApproval(
      input.tool,
      input.params,
      input.reason || policy.reason,
      (request) => {
        createdRequest = request;
        const pendingAction = {
          ...action,
          id: request.id,
          resumeAction: { type: "approval" as const, payloadId: request.id },
        };
        input.onActionCreated?.(pendingAction, policy);
        input.onCreated?.(request, pendingAction, policy);
      },
    );
    const resolved = resolveActionRequiredEvent(
      { ...action, id: createdRequest?.id || action.id, resumeAction: { type: "approval", payloadId: createdRequest?.id || action.id } },
      { approved, reason: approved ? policy.reason : "User denied this action." },
    );
    input.onActionResolved?.(resolved, policy);

    return {
      approved,
      action: resolved,
      policy,
      toolResult: actionRequiredToolResult(resolved),
    };
  }
}
