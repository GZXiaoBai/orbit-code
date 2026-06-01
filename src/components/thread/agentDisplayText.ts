import type { AppCopy } from "../../i18n/copy";

export function localizedRuntimeName(copy: AppCopy, name: string): string {
  const names: Record<string, string> = {
    "Plan Ready": copy.workbench.agentEventNames.planReady,
    "Patch Proposal": copy.workbench.agentEventNames.patchProposal,
    "Question": copy.workbench.agentEventNames.question,
    "Verification": copy.workbench.agentEventNames.verification,
    "Run Guard": copy.workbench.agentEventNames.runGuard,
    "Agent Error": copy.workbench.agentEventNames.agentError,
    "Final Summary": copy.workbench.agentEventNames.finalSummary,
    "Codex Sidecar Runtime": copy.language === "中" ? "Codex 运行时" : "Codex runtime",
    "Codex Turn Accepted": copy.language === "中" ? "Codex 已接收" : "Codex accepted",
    "Codex Sidecar Unavailable": copy.language === "中" ? "Codex 不可用" : "Codex unavailable",
  };
  if (names[name]) return names[name];
  const phase = name.match(/^Agent \(([^)]+)\)$/)?.[1] as keyof typeof copy.workbench.agentPhases | undefined;
  return phase ? copy.workbench.agentPhases[phase] || phase : name;
}

export function localizedRuntimeText(_copy: AppCopy, text: string): string {
  return text;
}

export function compactRuntimeTextForTimeline(copyOrText: AppCopy | string, textOrMax?: string | number, maybeMax?: number): string {
  const text = typeof copyOrText === "string" ? copyOrText : String(textOrMax || "");
  const maxLength = typeof textOrMax === "number" ? textOrMax : maybeMax || 700;
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}
