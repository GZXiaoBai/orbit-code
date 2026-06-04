import { describe, expect, it } from "vitest";
import type { ModelCapability } from "../domain/types";
import { compactTokenCount, modelCapabilityBadges } from "../features/settings/SettingsWorkspace";
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
});
