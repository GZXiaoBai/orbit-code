import { invokeDesktop } from "./desktopGateway";
import type { CodexBridgeProvider, CodexItem, CodexItemEvent, CodexRuntimeStatus, CodexSidecarStatus, CodexSidecarVersionInfo, CodexThread, CodexTurn, DesktopBuildSmokeResult, RuntimeRestartResult, RuntimeRoute } from "../domain/codex";

export interface CodexStartThreadInput {
  workspacePath: string;
  title?: string;
  threadId?: string;
  mode: "plan" | "build";
  providerId: string;
  model: string;
}

export interface CodexStartTurnInput {
  threadId: string;
  workspacePath: string;
  prompt: string;
  mode: "plan" | "build";
  runtimeMode?: RuntimeRoute;
  providerId: string;
  model: string;
  reasoningEffort?: string;
}

export interface CodexThreadStartResult {
  thread: CodexThread;
  sidecar: CodexSidecarStatus;
}

export interface CodexTurnStartResult {
  turn: CodexTurn;
  items: CodexItem[];
}

export type AgentRuntimeEvent =
  | { type: "item"; payload: CodexItemEvent | CodexItem }
  | { type: "turn"; payload: CodexTurn }
  | { type: "status"; payload: { status: CodexRuntimeStatus; error?: string } }
  | { type: "error"; payload: { message: string } };

export interface AgentRuntimePort {
  status(): Promise<CodexSidecarStatus>;
  sidecarInfo(): Promise<CodexSidecarVersionInfo>;
  desktopBuildSmokeReport(): Promise<DesktopBuildSmokeResult | null>;
  restart(providerId?: string): Promise<RuntimeRestartResult>;
  providers(): Promise<CodexBridgeProvider[]>;
  startThread(input: CodexStartThreadInput): Promise<CodexThreadStartResult>;
  startTurn(input: CodexStartTurnInput): Promise<CodexTurnStartResult>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  submitApproval(actionId: string, approved: boolean, answer?: string): Promise<void>;
  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void;
}

export const codexAgentRuntimePort: AgentRuntimePort = {
  status() {
    return invokeDesktop<CodexSidecarStatus>("codex_sidecar_status");
  },
  sidecarInfo() {
    return invokeDesktop<CodexSidecarVersionInfo>("codex_sidecar_version_info");
  },
  desktopBuildSmokeReport() {
    return invokeDesktop<DesktopBuildSmokeResult | null>("codex_desktop_build_smoke_report");
  },
  restart(providerId = "deepseek") {
    return invokeDesktop<RuntimeRestartResult>("codex_runtime_restart", { providerId });
  },
  providers() {
    return invokeDesktop<CodexBridgeProvider[]>("orbit_bridge_provider_catalog");
  },
  startThread(input) {
    return invokeDesktop<CodexThreadStartResult>("codex_thread_start", { input });
  },
  startTurn(input) {
    return invokeDesktop<CodexTurnStartResult>("codex_turn_start", { input });
  },
  interruptTurn(threadId, turnId) {
    return invokeDesktop("codex_turn_interrupt", { threadId, turnId });
  },
  submitApproval(actionId, approved, answer) {
    return invokeDesktop("codex_approval_submit", { actionId, approved, answer });
  },
  subscribe(listener) {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      cleanups.push(await listen<CodexItemEvent | CodexItem>("codex://item", (event) => {
        if (!disposed) listener({ type: "item", payload: event.payload });
      }));
      cleanups.push(await listen<CodexTurn>("codex://turn", (event) => {
        if (!disposed) listener({ type: "turn", payload: event.payload });
      }));
      cleanups.push(await listen<{ status: CodexRuntimeStatus; error?: string }>("codex://status", (event) => {
        if (!disposed) listener({ type: "status", payload: event.payload });
      }));
      cleanups.push(await listen<{ message: string }>("codex://error", (event) => {
        if (!disposed) listener({ type: "error", payload: event.payload });
      }));
    }).catch((err) => {
      listener({ type: "error", payload: { message: err instanceof Error ? err.message : String(err) } });
    });
    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  },
};

export const codexAgentPort = codexAgentRuntimePort;
export type CodexAgentPort = AgentRuntimePort;
