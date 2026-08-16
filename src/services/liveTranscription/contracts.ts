export type LiveSource = 'mic' | 'system';

export interface LiveStreamUpdate {
  source: LiveSource;
  generation: number;
  revision: number;
  text: string;
  qualifiesPriorTentative: boolean;
  confidence: number;
  audioEndSeconds: number;
}

export interface LiveStreamSnapshot {
  source: LiveSource;
  generation: number;
  revision: number;
  committedPreviewText: string;
  tentativeText: string;
  audioEndSeconds: number;
}
