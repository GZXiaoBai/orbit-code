export type AgentRuntimeEvidenceStatus = "verified" | "partial" | "design-only" | "blocked" | "not-started";

export const PRODUCTION_AGENT_RUNTIME_ADAPTER_ID = "codex-app-server" as const;

export const AGENT_RUNTIME_PROMOTION_REQUIREMENTS = [
  {
    id: "event-stream",
    label: "Thread / Turn / Item event stream",
    description: "Emits stable machine events that project into Orbit thread, turn, item, error, and delta records.",
  },
  {
    id: "approval-user-input",
    label: "Approval and user input",
    description: "Routes approval and question requests through Orbit review UI without bypassing the local policy layer.",
  },
  {
    id: "terminal-file-edit",
    label: "Terminal and file edit metadata",
    description: "Preserves terminal output, command status, file edit previews, and patch metadata for Review Dock.",
  },
  {
    id: "usage-final-summary",
    label: "Usage and final summary",
    description: "Reports model usage and final assistant output as durable Orbit items.",
  },
  {
    id: "workspace-boundaries",
    label: "Workspace and patch boundaries",
    description: "Keeps file writes inside the selected workspace and preserves stale-write, rollback, and checkpoint behavior.",
  },
  {
    id: "session-mapping",
    label: "Session mapping and recovery",
    description: "Maintains Orbit thread to agent thread mapping across turns and recovers cleanly after reload or retry.",
  },
  {
    id: "interrupt-crash-cleanup",
    label: "Interrupt and crash cleanup",
    description: "Handles interrupt, pending request release, process crash, restart, and stuck turn cleanup.",
  },
  {
    id: "no-secret-config",
    label: "No-secret runtime config",
    description: "Reads credentials only from Orbit vault memory and never writes API keys into temporary config, logs, or smoke reports.",
  },
  {
    id: "desktop-live-smoke",
    label: "Packaged desktop live smoke",
    description: "Passes packaged desktop approve and deny Build smoke with real provider traffic.",
  },
] as const;

export type AgentRuntimeRequirementId = typeof AGENT_RUNTIME_PROMOTION_REQUIREMENTS[number]["id"];

export interface AgentRuntimeAdapterDecision {
  id: string;
  label: string;
  role: "production-core" | "isolated-spike" | "blocked";
  buildUiEnabled: boolean;
  blockedReason?: string;
  evidence: Record<AgentRuntimeRequirementId, AgentRuntimeEvidenceStatus>;
}

export interface AgentRuntimeEvidenceSummary {
  verified: number;
  total: number;
  missing: typeof AGENT_RUNTIME_PROMOTION_REQUIREMENTS[number][];
}

const codexEvidence = {
  "event-stream": "verified",
  "approval-user-input": "partial",
  "terminal-file-edit": "verified",
  "usage-final-summary": "verified",
  "workspace-boundaries": "verified",
  "session-mapping": "partial",
  "interrupt-crash-cleanup": "partial",
  "no-secret-config": "verified",
  "desktop-live-smoke": "partial",
} as const satisfies Record<AgentRuntimeRequirementId, AgentRuntimeEvidenceStatus>;

function evidenceWithStatus(status: AgentRuntimeEvidenceStatus): Record<AgentRuntimeRequirementId, AgentRuntimeEvidenceStatus> {
  return Object.fromEntries(
    AGENT_RUNTIME_PROMOTION_REQUIREMENTS.map((requirement) => [requirement.id, status])
  ) as Record<AgentRuntimeRequirementId, AgentRuntimeEvidenceStatus>;
}

export const AGENT_RUNTIME_ADAPTER_DECISIONS: AgentRuntimeAdapterDecision[] = [
  {
    id: PRODUCTION_AGENT_RUNTIME_ADAPTER_ID,
    label: "Codex app-server",
    role: "production-core",
    buildUiEnabled: true,
    evidence: codexEvidence,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    role: "isolated-spike",
    buildUiEnabled: false,
    blockedReason: "Not wired to production Build until it proves Orbit-compatible events, approval, file edit, recovery, and vault semantics.",
    evidence: evidenceWithStatus("not-started"),
  },
  {
    id: "opencode",
    label: "OpenCode",
    role: "isolated-spike",
    buildUiEnabled: false,
    blockedReason: "Not wired to production Build until it proves Orbit-compatible events, approval, file edit, recovery, and vault semantics.",
    evidence: evidenceWithStatus("not-started"),
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    role: "blocked",
    buildUiEnabled: false,
    blockedReason: "Plan mode and runtime event semantics are not verified against Orbit's Codex-shaped Thread / Turn / Item model.",
    evidence: evidenceWithStatus("not-started"),
  },
];

export function missingProductionEvidence(adapter: AgentRuntimeAdapterDecision): AgentRuntimeRequirementId[] {
  return AGENT_RUNTIME_PROMOTION_REQUIREMENTS
    .filter((requirement) => adapter.evidence[requirement.id] !== "verified")
    .map((requirement) => requirement.id);
}

export function agentRuntimeEvidenceSummary(adapter: AgentRuntimeAdapterDecision): AgentRuntimeEvidenceSummary {
  const missing = AGENT_RUNTIME_PROMOTION_REQUIREMENTS.filter((requirement) => adapter.evidence[requirement.id] !== "verified");
  return {
    verified: AGENT_RUNTIME_PROMOTION_REQUIREMENTS.length - missing.length,
    total: AGENT_RUNTIME_PROMOTION_REQUIREMENTS.length,
    missing,
  };
}

export function canPromoteReplacementRuntime(adapter: AgentRuntimeAdapterDecision): boolean {
  return adapter.role !== "blocked" && missingProductionEvidence(adapter).length === 0;
}
