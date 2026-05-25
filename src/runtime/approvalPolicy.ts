import type { ApprovalMode, PermissionAction, PermissionRequest, ProjectSecurityOverride, SecuritySettings } from "../domain/types";
import { buildEffectiveSecurityPolicy } from "./securityPolicy";

const dangerousPatterns = [
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bchmod\s+-R\b/,
  /\bchown\s+-R\b/,
  /\bcurl\b.*\|\s*(sh|bash)\b/,
  /\bwget\b.*\|\s*(sh|bash)\b/,
  /\b(open|cat|grep|rg)\b.*(\.env|id_rsa|\.pem|keychain)/i,
];

export function commandPermissionActions(command: string): PermissionAction[] {
  const safeReadOnlyCommand = /\b(git\s+diff|git\s+status|rg|ls|pwd|cat)\b/.test(command);
  const actions = new Set<PermissionAction>(safeReadOnlyCommand ? ["read"] : ["command"]);
  if (/\brg\b/.test(command)) actions.add("search");
  if (/\b(pnpm|npm|yarn|bun)\s+(add|install|remove)\b/.test(command)) actions.add("install");
  if (/\b(curl|wget|ssh|scp|git\s+(clone|pull|push|fetch))\b|https?:\/\//i.test(command)) actions.add("network");
  if (/(\.env|id_rsa|\.pem|keychain)/i.test(command)) actions.add("secrets");
  return [...actions];
}

export function classifyCommand(
  command: string,
  security?: SecuritySettings,
  projectOverride?: ProjectSecurityOverride,
): ApprovalMode {
  if (dangerousPatterns.some((pattern) => pattern.test(command))) return "deny";
  if (security || projectOverride) {
    const policy = buildEffectiveSecurityPolicy(security, projectOverride);
    const actions = commandPermissionActions(command);
    if (actions.some((action) => policy.decisions[action] === "deny")) return "deny";
    if (actions.some((action) => policy.decisions[action] === "ask")) return "ask";
    return "allow_once";
  }
  if (/\b(pnpm|npm|yarn|bun)\s+(add|install|remove)\b/.test(command)) {
    return "ask";
  }
  if (/\b(git\s+diff|git\s+status|rg|ls|pwd|cat)\b/.test(command)) {
    return "allow_once";
  }
  return "ask";
}

export function createPermissionRequest(
  command: string,
  cwd: string,
): PermissionRequest {
  const defaultMode = classifyCommand(command);

  return {
    id: crypto.randomUUID(),
    command,
    cwd,
    reason: "Agent requested a command while working on the active plan.",
    levels: command.includes("http") ? ["shell", "network"] : ["shell"],
    defaultMode,
  };
}
