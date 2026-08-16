export type LiveSource = 'mic' | 'system';

export type LiveEngineMode =
  | 'mlx'
  | 'system_shadow'
  | 'dual_shadow'
  | 'parakeet_primary';

export type LiveCaptureSequence = number;

export interface LiveStreamUpdate {
  source: LiveSource;
  generation: number;
  revision: number;
  text: string;
  qualifiesPriorTentative: boolean;
  confidence: number;
  audioEndSeconds: number;
  /** Exact durable capture-journal interval; never infer this from timing. */
  captureSequence?: LiveCaptureSequence;
  /** Parakeet append provenance before Electron maps it to a capture receipt. */
  committedThroughSequence?: number;
  tentativeThroughSequence?: number;
  committedThroughCaptureSequence?: LiveCaptureSequence;
  tentativeThroughCaptureSequence?: LiveCaptureSequence;
  engineEpoch?: number;
}

export interface LiveStreamSnapshot {
  source: LiveSource;
  generation: number;
  revision: number;
  committedPreviewText: string;
  tentativeText: string;
  audioEndSeconds: number;
  captureSequence?: LiveCaptureSequence;
  committedThroughSequence?: number;
  tentativeThroughSequence?: number;
  committedThroughCaptureSequence?: LiveCaptureSequence;
  tentativeThroughCaptureSequence?: LiveCaptureSequence;
  engineEpoch?: number;
}
