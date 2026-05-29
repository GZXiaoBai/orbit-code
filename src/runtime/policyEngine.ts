import type { AgentRuntimeMode, ToolName, ToolParams } from "../domain/agentLoop";
import { approvalGrantKey, policyGrantMatches, type ApprovalGrantScope, type PolicyGrant } from "../domain/approvalGrant";
import type {
  PermissionAction,
  PermissionDecision,
  ProjectSecurityOverride,
  SecuritySettings,
} from "../domain/types";
import { commandPermissionActions } from "./approvalPolicy";
import { formatCommandForDisplay } from "./commandParser";
import { buildEffectiveSecurityPolicy } from "./securityPolicy";
import { isToolAllowedInMode } from "../domain/agentModeContract";

export type PolicyDecisionKind = "allow" | "ask" | "deny" | "sandbox";

export interface PolicyEvaluationRequest {
  mode: AgentRuntimeMode;
  tool: ToolName | string;
  params?: ToolParams;
  workspacePath?: string;
  threadId?: string;
  grantScope?: ApprovalGrantScope;
  approvalGrants?: PolicyGrant[];
  security?: SecuritySettings;
  projectOverride?: ProjectSecurityOverride;
  projectRuleDecisions?: Partial<Record<PermissionAction, PermissionDecision>>;
}

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  actions: PermissionAction[];
  reason: string;
  sandboxMode?: SecuritySettings["sandboxMode"];
}

const writeTools = new Set(["apply_patch", "propose_patch"]);

function actionDecisionRank(decision: PermissionDecision): number {
  if (decision === "deny") return 3;
  if (decision === "ask") return 2;
  return 1;
}

function mergeRestrictiveDecisions(
  base: Partial<Record<PermissionAction, PermissionDecision>>,
  dynamic?: Partial<Record<PermissionAction, PermissionDecision>>,
): Partial<Record<PermissionAction, PermissionDecision>> {
  if (!dynamic) return base;
  const merged = { ...base };
  for (const [action, decision] of Object.entries(dynamic) as Array<[PermissionAction, PermissionDecision]>) {
    const current = merged[action] || "ask";
    merged[action] = actionDecisionRank(decision) > actionDecisionRank(current) ? decision : current;
  }
  return merged;
}

export function inferPermissionActions(tool: string, params?: ToolParams): PermissionAction[] {
  if (tool === "read_file") return ["read"];
  if (tool === "list_files") return ["read"];
  if (tool === "search_code") return ["read", "search"];
  if (tool === "ask_user") return [];
  if (writeTools.has(tool)) return ["write"];
  if (tool === "run_command") {
    const command = typeof params?.command === "string" ? params.command : "";
    const args = Array.isArray(params?.args) ? params.args.filter((arg): arg is string => typeof arg === "string") : [];
    return commandPermissionActions(formatCommandForDisplay(command, args));
  }
  return ["command"];
}

export class PolicyEngine {
  evaluate(request: PolicyEvaluationRequest): PolicyDecision {
    const tool = request.tool as ToolName;
    if (!isToolAllowedInMode(request.mode, tool)) {
      return {
        decision: "deny",
        actions: inferPermissionActions(request.tool, request.params),
        reason: `${request.mode} mode does not allow ${request.tool}.`,
      };
    }

    const actions = inferPermissionActions(request.tool, request.params);
    if (actions.length === 0) {
      return { decision: "allow", actions, reason: `${request.tool} does not require permission.` };
    }

    const key = approvalGrantKey(request.tool, request.params || {});
    const matchingGrant = request.approvalGrants?.find((grant) => policyGrantMatches({
      grant,
      mode: request.mode,
      tool: request.tool,
      key,
      actions,
      workspacePath: request.workspacePath,
      threadId: request.threadId,
    }));
    if (matchingGrant) {
      return {
        decision: "allow",
        actions,
        reason: `${matchingGrant.scope} approval grant allows ${request.tool}.`,
      };
    }

    const effective = buildEffectiveSecurityPolicy(request.security, request.projectOverride);
    const decisions = mergeRestrictiveDecisions(effective.decisions, request.projectRuleDecisions);
    const strongest = actions
      .map((action) => decisions[action] || "ask")
      .sort((a, b) => actionDecisionRank(b) - actionDecisionRank(a))[0] || "ask";

    if (strongest === "deny") {
      return {
        decision: "deny",
        actions,
        reason: `Security policy denies ${actions.join(", ")} for ${request.tool}.`,
      };
    }

    if (strongest === "ask") {
      return {
        decision: "ask",
        actions,
        reason: `User confirmation required for ${actions.join(", ")}.`,
        sandboxMode: effective.preset === "fullAccess" ? request.security?.sandboxMode : undefined,
      };
    }

    if (request.security?.sandboxMode && request.security.sandboxMode !== "none" && actions.includes("command")) {
      return {
        decision: "sandbox",
        actions,
        reason: `Allowed command must run under ${request.security.sandboxMode} sandbox.`,
        sandboxMode: request.security.sandboxMode,
      };
    }

    return {
      decision: "allow",
      actions,
      reason: `Security policy allows ${actions.join(", ")} for ${request.tool}.`,
    };
  }
}

export const defaultPolicyEngine = new PolicyEngine();
