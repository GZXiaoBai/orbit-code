import { describe, expect, it } from "vitest";
import { getProviderSmokeRecord, setProviderSmokeRecord } from "../state/providerSmoke";
import { normalizeProviderSettings, type ProviderSettings } from "../state/useSession";
import { setImportedModels } from "../state/modelSettings";

describe("provider smoke state", () => {
  it("reports not configured when provider has no imported models", () => {
    const settings = normalizeProviderSettings({ activeProviderId: "openai", configs: {} } as ProviderSettings);
    expect(getProviderSmokeRecord(settings, "openai").status).toBe("notConfigured");
  });

  it("reports imported when models exist but no smoke was run", () => {
    const settings = setImportedModels(
      normalizeProviderSettings({ activeProviderId: "fixture", configs: {} } as ProviderSettings),
      "fixture",
      ["fixture-coder"],
    );
    expect(getProviderSmokeRecord(settings, "fixture").status).toBe("imported");
  });

  it("persists smoke pass and fail records", () => {
    const settings = normalizeProviderSettings({ activeProviderId: "fixture", configs: {} } as ProviderSettings);
    const next = setProviderSmokeRecord(settings, "fixture", { status: "smokePassed", message: "ok", checkedAt: "t1" });

    expect(getProviderSmokeRecord(next, "fixture")).toEqual({ status: "smokePassed", message: "ok", checkedAt: "t1" });
  });
});
