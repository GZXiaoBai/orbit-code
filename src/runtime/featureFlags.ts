export interface ExperimentalFeatureFlags {
  piSdkAdapter: boolean;
}

export interface OrbitFeatureFlags {
  experimental: ExperimentalFeatureFlags;
}

export const defaultFeatureFlags: OrbitFeatureFlags = {
  experimental: {
    piSdkAdapter: false,
  },
};

export function resolveFeatureFlags(input?: Partial<OrbitFeatureFlags>): OrbitFeatureFlags {
  return {
    experimental: {
      ...defaultFeatureFlags.experimental,
      ...(input?.experimental || {}),
    },
  };
}
