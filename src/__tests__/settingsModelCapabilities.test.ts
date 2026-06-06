import { describe, expect, it } from "vitest";
import type { CodexRuntimeSettingsModel, ProviderBridgeStatus, ProviderBuildGate } from "../domain/codex";
import type { ModelCapability } from "../domain/types";
import { compactTokenCount, modelCapabilityBadges, runtimeBetaGates, runtimeBetaReady } from "../features/settings/SettingsWorkspace";
import { copy } from "../i18n/copy";

describe("settings model capability display", () => {
  it("formats large token windows for compact model badges", () => {
    expect(compactTokenCount(undefined)).toBeUndefined();
    expect(compactTokenCount(999)).toBe("999");
    expect(compactTokenCount(32_768)).toBe("32.8K");
    expect(compactTokenCount(400_000)).toBe("400K");
    expect(compactTokenCount(1_048_576)).toBe("1.05M");
  });

  it("builds localized capability badges from imported API metadata", () => {
    const capability: ModelCapability = {
      streaming: true,
      reasoningLevels: ["auto", "high"],
      toolCalls: true,
      local: false,
      buildSupported: false,
      maxContextTokens: 400_000,
      maxOutputTokens: 32_768,
      capabilitySource: "api" as const,
    };

    expect(modelCapabilityBadges(copy.zh, capability)).toEqual([
      "上下文 400K",
      "输出 32.8K",
      "工具",
      "API",
    ]);
    expect(modelCapabilityBadges(copy.en, { ...capability, local: true, capabilitySource: "officialTable" })).toEqual([
      "Context 400K",
      "Output 32.8K",
      "Tools",
      "Local",
      "Official",
    ]);
  });

  it("summarizes the desktop Beta runtime gate", () => {
    const runtime: CodexRuntimeSettingsModel = {
      sidecarStatus: { running: true, pid: 4242 },
      sidecarInfo: { version: "codex 0.1.0", source: "bundled", path: "/tmp/codex", sha256: "abc123" },
      bridgeStatus: "ready",
      bridgeBaseUrl: "http://127.0.0.1:49152",
      latestDesktopBuildSmoke: {
        id: "smoke-1",
        scope: "desktop-build-live",
        startedAt: "2026-06-06T00:00:00.000Z",
        completedAt: "2026-06-06T00:01:00.000Z",
        result: "verified",
        liveBuildEnabled: true,
        denyApproval: false,
        smokeFile: "latest-tauri-webdriver-build-smoke.json",
        criteria: [
          { id: "final-summary", label: "final summary", status: "verified", message: "ok" },
        ],
      },
    };
    const activeGate: ProviderBuildGate = {
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      canBuild: true,
      canStream: true,
      bridgeStatus: "ready",
    };
    const bridgeStatus: ProviderBridgeStatus = {
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      modelDiscovery: "ready",
      bridgeSmoke: "passed",
      buildEnabled: true,
    };

    expect(runtimeBetaReady({ runtime, activeGate, bridgeStatus })).toBe(true);
    expect(runtimeBetaGates({ runtime, activeGate, bridgeStatus }).every((gate) => gate.ok)).toBe(true);
  });

  it("keeps Beta blocked when live desktop Build evidence is missing", () => {
    const runtime: CodexRuntimeSettingsModel = {
      sidecarStatus: { running: true, pid: 4242 },
      bridgeStatus: "ready",
      bridgeBaseUrl: "http://127.0.0.1:49152",
      latestDesktopBuildSmoke: {
        id: "smoke-1",
        scope: "desktop-build-readiness",
        startedAt: "2026-06-06T00:00:00.000Z",
        completedAt: "2026-06-06T00:01:00.000Z",
        result: "verified",
        liveBuildEnabled: false,
        denyApproval: false,
        smokeFile: "latest-tauri-webdriver-build-smoke.json",
        criteria: [],
      },
    };
    const activeGate: ProviderBuildGate = {
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      canBuild: true,
      canStream: true,
      bridgeStatus: "ready",
    };
    const bridgeStatus: ProviderBridgeStatus = {
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      modelDiscovery: "ready",
      bridgeSmoke: "passed",
      buildEnabled: true,
    };

    const gates = runtimeBetaGates({ runtime, activeGate, bridgeStatus });
    expect(runtimeBetaReady({ runtime, activeGate, bridgeStatus })).toBe(false);
    expect(gates.find((gate) => gate.id === "desktop-build-live")).toMatchObject({ ok: false });
  });

  it("does not block Beta when the bundled sidecar is available but currently stopped", () => {
    const runtime: CodexRuntimeSettingsModel = {
      sidecarStatus: { running: false },
      sidecarInfo: { source: "bundled", path: "/tmp/codex", sha256: "abc123" },
      bridgeStatus: "stopped",
      latestDesktopBuildSmoke: {
        id: "smoke-1",
        scope: "desktop-build-live",
        startedAt: "2026-06-06T00:00:00.000Z",
        completedAt: "2026-06-06T00:01:00.000Z",
        result: "verified",
        liveBuildEnabled: true,
        denyApproval: false,
        smokeFile: "latest-tauri-webdriver-build-smoke.json",
        criteria: [],
      },
    };
    const activeGate: ProviderBuildGate = {
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      canBuild: true,
      canStream: true,
      bridgeStatus: "ready",
    };
    const bridgeStatus: ProviderBridgeStatus = {
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      modelDiscovery: "ready",
      bridgeSmoke: "passed",
      buildEnabled: true,
    };

    const gates = runtimeBetaGates({ runtime, activeGate, bridgeStatus });
    expect(gates.find((gate) => gate.id === "sidecar")).toMatchObject({ ok: true });
    expect(gates.find((gate) => gate.id === "bridge")).toMatchObject({ ok: true });
    expect(runtimeBetaReady({ runtime, activeGate, bridgeStatus })).toBe(true);
  });
});
