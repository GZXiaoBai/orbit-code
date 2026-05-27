import { invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "../domain/agentEvents";
import type { ThreadEvent } from "../domain/threadEvents";
import type { CodingPlan, ProviderSmokeRecord } from "../domain/types";
import type { ModelCapability } from "../domain/types";
import type { AgentRunSession } from "../domain/agentRunSession";
import type { QuestionRequest } from "../domain/questionRequest";
import type { TerminalRun } from "../domain/terminalRun";
import type { ApprovalGrant, ApprovalRequest } from "../state/useApprovalQueue";
import type { ImportedPlanState } from "../state/useWorkspace";
import { isTauri } from "../utils/tauri";

interface StoredProviderConfig {
  baseUrl?: string;
  defaultModel?: string;
  importedModels?: string[];
  enabledModels?: string[];
  customModels?: string[];
  modelCapabilities?: Record<string, ModelCapability>;
}

export interface SessionState {
  activeProjectId: string;
  activeThreadId: string;
  importedPlan: ImportedPlanState | null;
  providerSettings: {
    activeProviderId: string;
    configs: Record<string, StoredProviderConfig>;
    sandboxMode?: string;
    smokeStatus?: Record<string, ProviderSmokeRecord>;
  };
  agentEvents: AgentEvent[];
  threadEvents?: ThreadEvent[];
  agentRunSession?: AgentRunSession;
  approvalRequests?: ApprovalRequest[];
  approvalGrants?: ApprovalGrant[];
  questionRequests?: QuestionRequest[];
  terminalRuns?: TerminalRun[];
  lastActiveAt: string;
}

export const sessionStore = {
  async saveSession(session: SessionState): Promise<void> {
    if (!isTauri()) {
      localStorage.setItem("agent-gui.session", JSON.stringify(session));
      return;
    }
    try {
      await invoke("save_session_state", {
        key: "session:current",
        value: JSON.stringify(session),
      });
    } catch (e) {
      console.warn("[SessionStore] Save failed, falling back to localStorage", e);
      localStorage.setItem("agent-gui.session", JSON.stringify(session));
    }
  },

  async loadSession(): Promise<SessionState | null> {
    if (!isTauri()) {
      const raw = localStorage.getItem("agent-gui.session");
      if (!raw) return null;
      try { return JSON.parse(raw) as SessionState; } catch { return null; }
    }
    try {
      const raw = await invoke<string | null>("load_session_state", {
        key: "session:current",
      });
      if (!raw) return null;
      return JSON.parse(raw) as SessionState;
    } catch (e) {
      console.warn("[SessionStore] Load failed, trying localStorage fallback", e);
      const raw = localStorage.getItem("agent-gui.session");
      if (!raw) return null;
      try { return JSON.parse(raw) as SessionState; } catch { return null; }
    }
  },

  async savePlan(plan: CodingPlan, fileName: string): Promise<void> {
    if (!isTauri()) {
      localStorage.setItem("agent-gui.plan", JSON.stringify({ plan, fileName }));
      return;
    }
    try {
      const planId = `plan-${Date.now()}`;
      const threadId = "default";
      await invoke("save_plan", {
        id: planId,
        threadId,
        title: plan.title,
        goals: JSON.stringify(plan.goals),
        constraints: JSON.stringify(plan.constraints),
        acceptanceCriteria: JSON.stringify(plan.acceptanceCriteria),
        risks: JSON.stringify(plan.risks),
        referencesJson: JSON.stringify(plan.references),
        rawYaml: JSON.stringify(plan),
      });
      await invoke("save_plan_tasks", {
        planId,
        tasksJson: JSON.stringify(plan.tasks),
      });
    } catch (e) {
      console.warn("[SessionStore] Save plan failed", e);
    }
  },

  async loadPlan(): Promise<{ plan: CodingPlan; fileName: string } | null> {
    if (!isTauri()) {
      const raw = localStorage.getItem("agent-gui.plan");
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }
    try {
      const planRow = await invoke<any | null>("load_plan", { threadId: "default" });
      if (!planRow) return null;
      const tasks = await invoke<any[]>("load_plan_tasks", { planId: planRow.id });
      const plan: CodingPlan = {
        version: "1",
        title: planRow.title,
        goals: JSON.parse(planRow.goals || "[]"),
        constraints: JSON.parse(planRow.constraints || "[]"),
        tasks: tasks.map((t: any) => ({
          id: t.id,
          title: t.title,
          description: t.description || "",
          status: t.status,
          dependsOn: t.dependsOn || [],
          agentHint: t.agentHint || undefined,
          filesHint: t.filesHint || [],
          verification: t.verification || [],
        })),
        acceptanceCriteria: JSON.parse(planRow.acceptance_criteria || "[]"),
        risks: JSON.parse(planRow.risks || "[]"),
        references: JSON.parse(planRow.references_json || "[]"),
      };
      return { plan, fileName: planRow.title };
    } catch (e) {
      console.warn("[SessionStore] Load plan failed", e);
      return null;
    }
  },

  async saveProviderConfigs(
    configs: Record<string, StoredProviderConfig>
  ): Promise<void> {
    if (!isTauri()) return;
    try {
      for (const [providerId, cfg] of Object.entries(configs)) {
        await invoke("save_provider_config", {
          id: `cfg-${providerId}`,
          provider: providerId,
          label: providerId,
          apiKeyProviderId: providerId,
          baseUrl: cfg.baseUrl || "",
          defaultModel: cfg.defaultModel || "",
          capabilities: "{}",
          configJson: JSON.stringify(cfg),
        });
      }
    } catch (e) {
      console.warn("[SessionStore] Save provider configs failed", e);
    }
  },

  async loadProviderConfigs(): Promise<Record<string, StoredProviderConfig>> {
    if (!isTauri()) return {};
    try {
      const configs = await invoke<any[]>("list_provider_configs");
      const result: Record<string, StoredProviderConfig> = {};
      for (const cfg of configs) {
        const rawConfig = cfg.config_json ? JSON.parse(cfg.config_json) : {};
        result[cfg.provider] = {
          baseUrl: cfg.base_url || undefined,
          defaultModel: cfg.default_model || undefined,
          importedModels: rawConfig.importedModels || [],
          enabledModels: rawConfig.enabledModels || [],
          customModels: rawConfig.customModels || [],
          modelCapabilities: rawConfig.modelCapabilities || {},
        };
      }
      return result;
    } catch (e) {
      console.warn("[SessionStore] Load provider configs failed", e);
      return {};
    }
  },
};
