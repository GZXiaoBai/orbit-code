import { describe, expect, it } from "vitest";
import { ORBIT_CODE_VAULT_PREFIX } from "../storage/keychain";
import { fallbackCapability, isOpenAICompatibleProvider, normalizeModelInfo } from "../providers/providerAdapters";

describe("provider persistence and adapters", () => {
  it("uses Orbit Code encrypted credential vault keys", () => {
    expect(ORBIT_CODE_VAULT_PREFIX).toBe("credential.vault.");
  });

  it("treats newly added providers as OpenAI-compatible where appropriate", () => {
    expect(isOpenAICompatibleProvider("openrouter")).toBe(true);
    expect(isOpenAICompatibleProvider("siliconflow")).toBe(true);
    expect(isOpenAICompatibleProvider("anthropic")).toBe(false);
  });

  it("normalizes OpenRouter model metadata with API context length", () => {
    const info = normalizeModelInfo("openrouter", {
      id: "openai/gpt-5.1-codex",
      context_length: 400_000,
      supported_parameters: ["tools"],
    });

    expect(info?.capability.maxContextTokens).toBe(400_000);
    expect(info?.capability.toolCalls).toBe(true);
    expect(info?.capability.capabilitySource).toBe("api");
  });

  it("falls back to official capability table for domestic providers", () => {
    const capability = fallbackCapability("kimi", "kimi-k2-thinking-turbo");

    expect(capability.maxContextTokens).toBeGreaterThanOrEqual(128_000);
    expect(capability.reasoningLevels).toContain("deep");
  });
});
