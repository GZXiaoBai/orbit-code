import { describe, expect, it } from "vitest";
import { optionsForReasoningEffort, reasoningInstruction } from "../services/llmService";
import { defaultModelForProvider, isReasoningEffort } from "../state/useRunControls";
import type { ProviderSettings } from "../state/useSession";
import {
  addCustomModel,
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

    expect(buildRunModelOptions(settings)).toHaveLength(0);
    expect(defaultModelForProvider("openai", settings, { openai: "sk-test" })).toBe("gpt-5");
    expect(buildRunModelOptions(settings, { openai: "sk-test" }).map((option) => option.id)).toEqual([
      "openai:gpt-5",
      "openai:gpt-5-mini",
    ]);
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

  it("marks compatible hosted providers as Build-supported with context metadata", () => {
    const settings = setImportedModels(emptySettings, "openrouter", ["openai/gpt-5.1-codex"]);
    const options = buildRunModelOptions(settings, { openrouter: "sk-test" });

    expect(options[0]?.capability?.buildSupported).toBe(true);
    expect(options[0]?.capability?.maxContextTokens).toBeGreaterThanOrEqual(400_000);
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
