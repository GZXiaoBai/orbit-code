import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_ADAPTER_DECISIONS,
  AGENT_RUNTIME_PROMOTION_REQUIREMENTS,
  PRODUCTION_AGENT_RUNTIME_ADAPTER_ID,
  agentRuntimeEvidenceSummary,
  canPromoteReplacementRuntime,
  missingProductionEvidence,
} from "../runtime/agentRuntimeConformance";

const sourceModules = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const agentRuntimePortSource = sourceModules["../runtime/agentRuntimePort.ts"];
const settingsWorkspaceSource = sourceModules["../features/settings/SettingsWorkspace.tsx"];

function productionSource(): string {
  return Object.entries(sourceModules)
    .filter(([file]) => !file.includes("/__tests__/") && !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    .map(([, source]) => source)
    .join("\n");
}

describe("Codex runtime boundary", () => {
  it("keeps deleted legacy Agent runtime modules out of production source", () => {
    const forbidden = [
      "agentLoopEngine",
      "ToolLoopController",
      "BuildTurnRuntime",
      "AgentTurnRunner",
      "ToolCallExecutor",
      "PiAgentKernel",
      "PiToolExecutor",
      "useApprovalQueue",
      "legacyQueuesForMigrationOnly",
      "parseToolEnvelopes",
    ];
    const haystack = productionSource();
    for (const token of forbidden) {
      expect(haystack).not.toContain(token);
    }
  });

  it("keeps Codex as the production AgentRuntimePort adapter", () => {
    expect(agentRuntimePortSource).toContain("./codexAgentPort");
    expect(agentRuntimePortSource).toContain("codexAgentRuntimePort as agentRuntimePort");
    expect(agentRuntimePortSource).not.toMatch(/claude|gemini|opencode|openCode|OpenCode/i);
  });

  it("keeps alternative Agent adapters isolated until they satisfy runtime conformance", () => {
    const productionAdapters = AGENT_RUNTIME_ADAPTER_DECISIONS.filter((adapter) => adapter.buildUiEnabled);
    expect(productionAdapters.map((adapter) => adapter.id)).toEqual([PRODUCTION_AGENT_RUNTIME_ADAPTER_ID]);

    const requirementIds = AGENT_RUNTIME_PROMOTION_REQUIREMENTS.map((requirement) => requirement.id);
    expect(new Set(requirementIds).size).toBe(requirementIds.length);

    for (const adapter of AGENT_RUNTIME_ADAPTER_DECISIONS) {
      expect(Object.keys(adapter.evidence).sort()).toEqual([...requirementIds].sort());
      if (adapter.id !== PRODUCTION_AGENT_RUNTIME_ADAPTER_ID) {
        expect(adapter.buildUiEnabled).toBe(false);
        expect(canPromoteReplacementRuntime(adapter)).toBe(false);
        expect(missingProductionEvidence(adapter).length).toBeGreaterThan(0);
      }
    }
  });

  it("computes conformance evidence summaries from the shared checklist", () => {
    const codex = AGENT_RUNTIME_ADAPTER_DECISIONS.find((adapter) => adapter.id === PRODUCTION_AGENT_RUNTIME_ADAPTER_ID);
    expect(codex).toBeTruthy();
    const summary = agentRuntimeEvidenceSummary(codex!);
    const missingIds = summary.missing.map((requirement) => requirement.id);

    expect(summary.total).toBe(AGENT_RUNTIME_PROMOTION_REQUIREMENTS.length);
    expect(summary.verified + summary.missing.length).toBe(summary.total);
    expect(missingIds).toEqual(missingProductionEvidence(codex!));
    expect(summary.missing.map((requirement) => requirement.label)).toContain("Packaged desktop live smoke");
  });

  it("surfaces Agent runtime conformance in the Settings runtime control plane", () => {
    expect(settingsWorkspaceSource).toContain("AGENT_RUNTIME_ADAPTER_DECISIONS");
    expect(settingsWorkspaceSource).toContain("AGENT_RUNTIME_PROMOTION_REQUIREMENTS");
    expect(settingsWorkspaceSource).toContain("agentRuntimeEvidenceSummary");
    expect(settingsWorkspaceSource).toContain("Agent runtime");
    expect(settingsWorkspaceSource).toContain("Build core");
  });
});
