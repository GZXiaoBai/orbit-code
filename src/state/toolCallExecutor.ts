import type { ToolCall, ToolParams } from "../domain/agentLoop";
import {
  createToolCallLifecycle,
  type ToolCallLifecycle,
  type ToolCallLifecycleStatus,
} from "../domain/toolCallLifecycle";
import type {
  PermissionScheduler,
  PermissionSchedulerRequest,
  PermissionSchedulerResult,
} from "../runtime/permissionScheduler";
import type { PolicyDecision } from "../runtime/policyEngine";
import type { ApprovalRequest } from "./useApprovalQueue";

export interface ToolLifecycleStore {
  list(): ToolCallLifecycle[];
  append(call: ToolCallLifecycle): void;
  update(
    id: string,
    update: Partial<ToolCallLifecycle> | ((call: ToolCallLifecycle) => ToolCallLifecycle),
  ): void;
}

export interface ToolExecutionResult {
  approved: boolean;
  toolResult: string;
  actionRequiredId?: string;
  threadEventId?: string;
  terminalRunId?: string;
  policy?: PolicyDecision;
  status: ToolCallLifecycleStatus;
}

export interface ToolExecutionContext extends Omit<PermissionSchedulerRequest, "tool" | "params"> {
  permissionScheduler: PermissionScheduler;
}

export type RuntimeApprovalRequester = (
  tool: string,
  params: ToolParams,
  reason?: string,
  onCreated?: (request: ApprovalRequest) => void,
) => Promise<PermissionSchedulerResult>;

export interface RuntimeApprovalExecutionInput {
  toolCall: ToolCall;
  params: ToolParams;
  reason?: string;
  requestApproval: RuntimeApprovalRequester;
  onCreated?: (request: ApprovalRequest) => void;
}

export type RuntimeApprovalExecutionResult = ToolExecutionResult & {
  approval: PermissionSchedulerResult;
};

export class ToolCallExecutor {
  constructor(private readonly lifecycle: ToolLifecycleStore) {}

  recordGenerated(toolCall: ToolCall, argsSummary: string): void {
    const status: ToolCallLifecycleStatus = toolCall.status === "running" ? "running" : "generated";
    if (this.lifecycle.list().some((call) => call.id === toolCall.id)) {
      this.lifecycle.update(toolCall.id, {
        tool: toolCall.name,
        args: toolCall.params,
        argsSummary,
        status,
      });
      return;
    }
    this.lifecycle.append(createToolCallLifecycle({
      id: toolCall.id,
      tool: toolCall.name,
      args: toolCall.params,
      argsSummary,
      status,
    }));
  }

  recordResult(id: string, result: string): void {
    this.lifecycle.update(id, {
      status: /^Denied\b/i.test(result) || /Tool denied by/i.test(result)
        ? "denied"
        : /^Tool error:/i.test(result)
          ? "failed"
          : "completed",
      resultText: result,
    });
  }

  recordTerminalResult(input: {
    toolCallId: string;
    terminalRunId: string;
    result: string;
    exitCode?: number | null;
  }): ToolExecutionResult {
    const status: ToolCallLifecycleStatus = input.exitCode === 0 || input.exitCode == null ? "completed" : "failed";
    this.lifecycle.update(input.toolCallId, {
      status,
      terminalRunId: input.terminalRunId,
      resultText: input.result,
      error: status === "failed" ? `Command exited with code ${input.exitCode}` : undefined,
    });
    return {
      approved: true,
      toolResult: input.result,
      terminalRunId: input.terminalRunId,
      status,
    };
  }

  recordApprovalResult(input: {
    toolCallId?: string;
    approval: PermissionSchedulerResult;
  }): ToolExecutionResult {
    if (input.toolCallId) {
      this.lifecycle.update(input.toolCallId, {
        status: input.approval.approved ? "actionRequired" : "denied",
        policyDecision: input.approval.policy,
        actionRequiredId: input.approval.action.id,
        resultText: input.approval.toolResult,
      });
    }
    return {
      approved: input.approval.approved,
      toolResult: input.approval.toolResult,
      actionRequiredId: input.approval.action.id,
      policy: input.approval.policy,
      status: input.approval.approved ? "actionRequired" : "denied",
    };
  }

  recordPolicyEvaluated(id: string, policy: PolicyDecision): void {
    this.lifecycle.update(id, {
      status: policy.decision === "ask" ? "policyEvaluated" : policy.decision === "deny" ? "denied" : "policyEvaluated",
      policyDecision: policy,
      error: policy.decision === "deny" ? policy.reason : undefined,
      resultText: policy.decision === "deny" ? `Denied by policy: ${policy.reason}` : undefined,
    });
  }

  recordRunning(id: string): void {
    this.lifecycle.update(id, { status: "running" });
  }

  async requestApproval(input: RuntimeApprovalExecutionInput): Promise<RuntimeApprovalExecutionResult> {
    this.recordGenerated(input.toolCall, summarizeToolParamsForLifecycle(input.toolCall.name, input.params));
    const approval = await input.requestApproval(
      input.toolCall.name,
      input.params,
      input.reason,
      input.onCreated,
    );
    return {
      ...this.recordApprovalResult({ toolCallId: input.toolCall.id, approval }),
      approval,
    };
  }

  async execute(toolCall: ToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    this.recordGenerated(toolCall, summarizeToolParamsForLifecycle(toolCall.name, toolCall.params));
    const approval = await context.permissionScheduler.request({
      ...context,
      tool: toolCall.name,
      params: toolCall.params,
      toolCallId: context.toolCallId || toolCall.id,
      onActionCreated: (action, policy) => {
        this.recordPolicyEvaluated(toolCall.id, policy);
        if (policy.decision === "ask") {
          this.lifecycle.update(toolCall.id, {
            status: "actionRequired",
            policyDecision: policy,
            actionRequiredId: action.id,
          });
        }
        context.onActionCreated?.(action, policy);
      },
      onActionResolved: (action, policy) => {
        context.onActionResolved?.(action, policy);
      },
      onCreated: context.onCreated,
    });

    return this.recordApprovalResult({ toolCallId: toolCall.id, approval });
  }

  recordCancelled(id: string, reason = "Cancelled by user."): void {
    this.lifecycle.update(id, {
      status: "cancelled",
      resultText: reason,
    });
  }
}

export function summarizeToolParamsForLifecycle(tool: string, params: ToolParams): string {
  if (tool === "run_command") {
    const command = typeof params.command === "string" ? params.command : "command";
    const args = Array.isArray(params.args) ? params.args.filter((arg): arg is string => typeof arg === "string") : [];
    return [command, ...args].join(" ");
  }
  if (tool === "propose_patch" || tool === "apply_patch") {
    const patches = Array.isArray(params.patches) ? params.patches : [];
    const files = patches
      .map((patch) => typeof patch === "object" && patch && "path" in patch ? String((patch as { path?: unknown }).path || "") : "")
      .filter(Boolean);
    return files.length ? files.join(", ") : `${patches.length} patch item(s)`;
  }
  if (tool === "ask_user") return typeof params.question === "string" ? params.question : "User question";
  if (tool === "read_file") return typeof params.path === "string" ? params.path : "File read";
  if (tool === "search_code") return typeof params.query === "string" ? params.query : typeof params.pattern === "string" ? params.pattern : "Code search";
  if (tool === "list_files") return typeof params.filter === "string" ? params.filter : "List files";
  return tool;
}
