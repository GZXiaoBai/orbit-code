import type {
  PermissionAction,
  PermissionDecision,
  PermissionPreset,
  ProjectSecurityOverride,
  SecuritySettings,
} from "../domain/types";

export interface EffectiveSecurityPolicy {
  preset: PermissionPreset;
  decisions: Record<PermissionAction, PermissionDecision>;
}

const actions: PermissionAction[] = ["read", "search", "command", "write", "network", "install", "secrets"];

const presetDecisions: Record<PermissionPreset, Record<PermissionAction, PermissionDecision>> = {
  readOnly: {
    read: "allow",
    search: "allow",
    command: "deny",
    write: "deny",
    network: "ask",
    install: "deny",
    secrets: "ask",
  },
  askBeforeAction: {
    read: "allow",
    search: "allow",
    command: "ask",
    write: "ask",
    network: "ask",
    install: "ask",
    secrets: "ask",
  },
  fullAccess: {
    read: "allow",
    search: "allow",
    command: "allow",
    write: "ask",
    network: "ask",
    install: "ask",
    secrets: "ask",
  },
};

export const defaultSecuritySettings: SecuritySettings = {
  preset: "askBeforeAction",
  advancedRules: {},
  sandboxMode: "none",
};

export function buildEffectiveSecurityPolicy(
  global: SecuritySettings | undefined,
  project?: ProjectSecurityOverride,
): EffectiveSecurityPolicy {
  const base = global || defaultSecuritySettings;
  const preset = project?.preset || base.preset || "askBeforeAction";
  const decisions = { ...presetDecisions[preset] };
  const globalRules = base.advancedRules || {};
  const projectRules = project?.advancedRules || {};

  for (const action of actions) {
    if (globalRules[action]) decisions[action] = globalRules[action]!;
    if (projectRules[action]) decisions[action] = projectRules[action]!;
  }

  return { preset, decisions };
}

export function decisionToApprovalMode(decision: PermissionDecision) {
  if (decision === "allow") return "allow_once" as const;
  if (decision === "deny") return "deny" as const;
  return "ask" as const;
}

export function describePermissionPreset(preset: PermissionPreset): string {
  if (preset === "readOnly") return "Read only";
  if (preset === "fullAccess") return "Full access";
  return "Ask first";
}
