/**
 * Override full-session canonical Whisper input (mic vs mix-down).
 *
 * - Renderer: set `VITE_PLUTO_CANONICAL_SOURCE` in `.env` / build env.
 * - Node / replay: `PLUTO_CANONICAL_SOURCE`.
 *
 * Values: `mic` | `mix` | `auto` (default when unset: use tuning + availability).
 */
export type CanonicalSourceOverride = 'mic' | 'mix' | 'auto';

const normalizeOverride = (raw: unknown): CanonicalSourceOverride | null => {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'mic' || v === 'mix' || v === 'auto') return v;
  return null;
};

export const readCanonicalSourceOverride =
  (): CanonicalSourceOverride | null => {
    const fromProcess =
      typeof process !== 'undefined' && process.env
        ? process.env.PLUTO_CANONICAL_SOURCE
        : undefined;
    const fromVite =
      typeof import.meta !== 'undefined' && import.meta.env
        ? import.meta.env.VITE_PLUTO_CANONICAL_SOURCE
        : undefined;
    return normalizeOverride(fromProcess ?? fromVite);
  };

/**
 * Whether to decode canonical session text from the mixed WAV (when present).
 */
export const shouldUseMixForCanonicalTranscript = (params: {
  preferMixDefault: boolean;
  hasMixedAudioPath: boolean;
}): boolean => {
  const o = readCanonicalSourceOverride();
  if (o === 'mic') return false;
  if (o === 'mix') return params.hasMixedAudioPath;
  return params.preferMixDefault && params.hasMixedAudioPath;
};
