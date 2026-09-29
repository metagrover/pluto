export const FEATURE_FLAGS = {
  sources: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export const isFeatureEnabled = (flag: FeatureFlag): boolean =>
  FEATURE_FLAGS[flag];

export const assertFeatureEnabled = (flag: FeatureFlag): void => {
  if (!isFeatureEnabled(flag)) {
    throw new Error(`feature_disabled:${flag}`);
  }
};
