export const canonicalizeTranscriptCheckpointConfig = (
  config: Record<string, unknown>,
): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(config)
        .sort()
        .map((key) => [key, config[key]]),
    ),
  );
