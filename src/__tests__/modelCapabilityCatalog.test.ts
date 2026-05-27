import { describe, expect, it } from "vitest";
import { capabilityFromOfficialCatalog } from "../providers/modelCapabilityCatalog";
import { inferModelCapability } from "../state/modelSettings";

describe("model capability catalog", () => {
  it("uses DeepSeek official table fallback for context and reasoning", () => {
    const capability = inferModelCapability("deepseek", "deepseek-v4-pro");

    expect(capability.maxContextTokens).toBe(1_000_000);
    expect(capability.reasoningLevels).toEqual(["auto", "balanced", "high", "max"]);
    expect(capability.toolCalls).toBe(true);
    expect(capability.buildSupported).toBe(true);
    expect(capability.capabilitySource).toBe("officialTable");
  });

  it("keeps Ollama discovery-only for Build", () => {
    const catalog = capabilityFromOfficialCatalog("ollama", "qwen3-coder");
    const capability = inferModelCapability("ollama", "qwen3-coder");

    expect(catalog?.buildSupported).toBe(false);
    expect(capability.buildSupported).toBe(false);
  });
});
