import { describe, expect, it } from "vitest";
import { defaultFeatureFlags, resolveFeatureFlags } from "../runtime/featureFlags";

describe("feature flags", () => {
  it("keeps the Pi SDK adapter disabled by default", () => {
    expect(defaultFeatureFlags.experimental.piSdkAdapter).toBe(false);
    expect(resolveFeatureFlags().experimental.piSdkAdapter).toBe(false);
    expect(resolveFeatureFlags({ experimental: { piSdkAdapter: true } }).experimental.piSdkAdapter).toBe(true);
  });
});
