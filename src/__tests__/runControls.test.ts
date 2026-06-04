import { describe, expect, it } from "vitest";
import { optionsForReasoningEffort, reasoningInstruction } from "../services/llmService";
import { defaultModelForProvider, isReasoningEffort } from "../state/useRunControls";
import { buildEffectiveWorkspaceBuildGate } from "../state/useWorkspace";
import type { ProviderSettings } from "../state/useSession";
import {
  addCustomModel,
  buildProviderBuildGate,
  buildRunModelOptions,
  inferModelCapability,
  inferReasoningEfforts,
  resolveModelSelection,
  setImportedModels,
  setModelEnabled,
} from "../state/modelSettings";

const emptySettings: ProviderSettings = {
  activeProviderId: "openai",
  configs: {},
  sandboxMode: "none",
};

describe("run controls", () => {
  it("does not expose models before a provider is imported", () => {
    expect(defaultModelForProvider("openai", emptySettings)).toBe("");
    expect(buildRunModelOptions(emptySettings, { openai: "sk-test" })).toHaveLength(0);
  });

  it("imports API-provided models and exposes only those with credentials", () => {
    const settings = setImportedModels(emptySettings, "openai", ["gpt-5", "gpt-5-mini"]);

    expect(buildRunModelOptions(settings).map((option) => option.id)).toEqual([
      "openai:gpt-5",
      "openai:gpt-5-mini",
    ]);
    expect(defaultModelForProvider("openai", settings, { openai: "sk-test" })).toBe("gpt-5");
    expect(buildRunModelOptions(settings, { openai: "sk-test" }).map((option) => option.id)).toEqual([
      "openai:gpt-5",
      "openai:gpt-5-mini",
    ]);
  });

  it("keeps imported models visible when a credential vault is locked", () => {
    const settings = setImportedModels(emptySettings, "deepseek", ["deepseek-v4-pro"]);
    const options = buildRunModelOptions(settings);
    const selection = resolveModelSelection(settings, {}, { providerId: "deepseek" });

    expect(options.map((option) => option.id)).toEqual(["deepseek:deepseek-v4-pro"]);
    expect(selection?.model).toBe("deepseek-v4-pro");
  });

  it("does not let stale fixture selection override an imported active provider", () => {
    const settings = setImportedModels(emptySettings, "deepseek", ["deepseek-v4-flash"]);
    const selection = resolveModelSelection(settings, {}, { providerId: "fixture", model: "fixture-coder" });

    expect(selection?.id).toBe("deepseek:deepseek-v4-flash");
  });

  it("keeps custom models selectable after import", () => {
    const imported = setImportedModels(emptySettings, "deepseek", ["deepseek-chat"]);
    const next = addCustomModel(imported, "deepseek", "deepseek-custom");
    const options = buildRunModelOptions(next, { deepseek: "sk-test" });

    expect(options.find((option) => option.id === "deepseek:deepseek-custom")?.source).toBe("custom");
  });

  it("falls back when the selected model is disabled", () => {
    const imported = setImportedModels(emptySettings, "openai", ["gpt-5", "gpt-5-mini"]);
    const disabled = setModelEnabled(imported, "openai", "gpt-5", false);
    const selection = resolveModelSelection(disabled, { openai: "sk-test" }, { providerId: "openai", model: "gpt-5" });

    expect(selection?.id).not.toBe("openai:gpt-5");
    expect(selection?.model).toBe("gpt-5-mini");
  });

  it("infers reasoning controls from selected model names", () => {
    expect(inferReasoningEfforts("deepseek", "deepseek-reasoner")).toEqual(["balanced", "deep"]);
    expect(inferReasoningEfforts("google", "gemini-2.5-flash")).toEqual(["fast", "balanced"]);
  });

  it("fills DeepSeek V4 model capability from official metadata fallback", () => {
    const capability = inferModelCapability("deepseek", "deepseek-v4-pro");

    expect(capability.maxContextTokens).toBe(1_000_000);
    expect(capability.maxOutputTokens).toBe(384_000);
    expect(capability.reasoningLevels).toEqual(["auto", "balanced", "high", "max"]);
    expect(capability.capabilitySource).toBe("officialTable");
  });

  it("marks Ollama as model-discovery capable but not Build-supported", () => {
    const capability = inferModelCapability("ollama", "qwen3-coder");
    expect(capability.local).toBe(true);
    expect(capability.buildSupported).toBe(false);
  });

  it("keeps Ollama Build blocked with a provider-specific reason", () => {
    const imported = setImportedModels(emptySettings, "ollama", ["qwen3-coder"]);
    const gate = buildProviderBuildGate({
      providerId: "ollama",
      model: "qwen3-coder",
      settings: imported,
    });

    expect(gate).toMatchObject({
      canBuild: false,
      bridgeStatus: "blocked",
    });
    expect(gate.blockedReason).toContain("Ollama");
  });

  it("keeps unverified hosted bridge providers discovery-only until their adapter is verified", () => {
    const settings = setImportedModels(emptySettings, "openrouter", ["openai/gpt-5.1-codex"]);
    const options = buildRunModelOptions(settings, { openrouter: "sk-test" });

    expect(options[0]?.capability?.buildSupported).toBe(false);
    expect(options[0]?.capability?.maxContextTokens).toBeGreaterThanOrEqual(400_000);
  });

  it("persists API-discovered model capability metadata without bypassing Build gate", () => {
    const settings = setImportedModels(emptySettings, "openrouter", [{
      id: "openai/gpt-5.1-codex",
      capability: {
        streaming: true,
        reasoningLevels: ["auto", "high"],
        toolCalls: true,
        local: false,
        buildSupported: true,
        maxContextTokens: 400_000,
        maxOutputTokens: 32_768,
        capabilitySource: "api",
      },
    }]);
    const options = buildRunModelOptions(settings, { openrouter: "sk-test" });

    expect(options[0]?.capability).toMatchObject({
      maxContextTokens: 400_000,
      maxOutputTokens: 32_768,
      toolCalls: true,
      capabilitySource: "api",
      buildSupported: false,
    });
  });

  it("supports custom OpenAI-compatible model import while blocking Build until bridge verification", () => {
    const imported = setImportedModels(emptySettings, "custom-openai", ["private-coder"]);
    const settings = {
      ...imported,
      configs: {
        ...imported.configs,
        "custom-openai": {
          ...imported.configs["custom-openai"],
          baseUrl: "https://gateway.example/v1",
        },
      },
    };
    const options = buildRunModelOptions(settings, { "custom-openai": "sk-test" });
    const gate = buildProviderBuildGate({
      providerId: "custom-openai",
      model: "private-coder",
      settings,
      apiKeys: { "custom-openai": "sk-test" },
    });

    expect(options.map((option) => option.id)).toEqual(["custom-openai:private-coder"]);
    expect(options[0]?.capability?.buildSupported).toBe(false);
    expect(gate).toMatchObject({ canBuild: false, bridgeStatus: "blocked" });
  });

  it("gates Build to verified Codex bridge providers", () => {
    for (const providerId of ["deepseek", "fixture"]) {
      expect(inferModelCapability(providerId, `${providerId}-model`).buildSupported).toBe(true);
    }
    for (const providerId of ["openai", "anthropic", "google", "ollama", "openrouter", "xai", "mistral", "groq", "qwen", "kimi", "siliconflow", "zhipu", "together", "fireworks", "cerebras", "nvidia", "azure-openai", "custom-openai"]) {
      expect(inferModelCapability(providerId, `${providerId}-model`).buildSupported).toBe(false);
    }
  });

  it("does not require a persisted smoke record before DeepSeek Build submit", () => {
    const imported = setImportedModels(emptySettings, "deepseek", ["deepseek-v4-pro"]);
    const missingSmoke = buildProviderBuildGate({
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      settings: imported,
      apiKeys: { deepseek: "sk-test" },
    });
    const passed = buildProviderBuildGate({
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      settings: {
        ...imported,
        smokeStatus: {
          deepseek: { status: "smokePassed", message: "ok", checkedAt: "t1" },
        },
      },
      apiKeys: { deepseek: "sk-test" },
    });

    expect(missingSmoke).toMatchObject({ canBuild: true, bridgeStatus: "ready" });
    expect(passed).toMatchObject({ canBuild: true, bridgeStatus: "ready" });
  });

  it("enables real DeepSeek Build after bridge smoke passes", () => {
    const imported = setImportedModels(emptySettings, "deepseek", ["deepseek-v4-pro"]);
    const gate = buildProviderBuildGate({
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      settings: {
        ...imported,
        smokeStatus: {
          deepseek: { status: "smokePassed", message: "ok", checkedAt: "t1" },
        },
      },
      apiKeys: { deepseek: "sk-test" },
      sidecarStatus: {
        running: false,
        lastError: "Codex app-server stdin unavailable",
      },
    });

    expect(gate).toMatchObject({ canBuild: true, bridgeStatus: "ready" });
  });

  it("does not require an already-running sidecar before enabling Build submit", () => {
    const readyGate = {
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      canBuild: true,
      canStream: true,
      bridgeStatus: "ready" as const,
    };

    const deepseek = buildEffectiveWorkspaceBuildGate({
      gate: readyGate,
      providerId: "deepseek",
      sidecarStatus: { running: false, lastError: "No active Codex app-server stdin is available" },
      desktopRuntime: true,
    });
    const fixture = buildEffectiveWorkspaceBuildGate({
      gate: {
        providerId: "fixture",
        model: "fixture-coder",
        canBuild: true,
        canStream: true,
        bridgeStatus: "ready" as const,
      },
      providerId: "fixture",
      sidecarStatus: { running: false, lastError: "No active Codex app-server stdin is available" },
      desktopRuntime: true,
    });
    expect(deepseek).toMatchObject({ canBuild: true, bridgeStatus: "ready" });
    expect(fixture.canBuild).toBe(true);
  });

  it("validates reasoning effort values", () => {
    expect(isReasoningEffort("fast")).toBe(true);
    expect(isReasoningEffort("balanced")).toBe(true);
    expect(isReasoningEffort("deep")).toBe(true);
    expect(isReasoningEffort("max")).toBe(true);
    expect(isReasoningEffort("slow")).toBe(false);
  });

  it("maps reasoning effort to shared LLM options", () => {
    expect(optionsForReasoningEffort("fast")).toMatchObject({
      reasoningEffort: "fast",
      maxOutputTokens: 2000,
    });
    expect(optionsForReasoningEffort("balanced")).toMatchObject({
      reasoningEffort: "balanced",
      maxOutputTokens: 4000,
    });
    expect(optionsForReasoningEffort("deep")).toMatchObject({
      reasoningEffort: "deep",
      maxOutputTokens: 8000,
    });
    expect(optionsForReasoningEffort("max")).toMatchObject({
      reasoningEffort: "max",
      maxOutputTokens: 32000,
    });
  });

  it("adds effort-specific prompt instructions", () => {
    expect(reasoningInstruction("fast")).toContain("Fast");
    expect(reasoningInstruction("deep")).toContain("Deep");
  });
});
