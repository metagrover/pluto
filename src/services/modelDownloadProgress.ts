export type ModelPreparationPhase =
  | 'sizing'
  | 'downloading'
  | 'loading'
  | 'verifying';

export type ModelDownloadProgress = {
  phase: ModelPreparationPhase;
  downloadedBytes: number;
  totalBytes: number;
  bytesPerSecond: number | null;
};

export type ModelPreparationProgressEvent = Omit<
  ModelDownloadProgress,
  'bytesPerSecond'
>;

export const isModelPreparationProgressEvent = (
  value: unknown,
): value is ModelPreparationProgressEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    (event.phase === 'sizing' ||
      event.phase === 'downloading' ||
      event.phase === 'loading' ||
      event.phase === 'verifying') &&
    typeof event.downloadedBytes === 'number' &&
    Number.isSafeInteger(event.downloadedBytes) &&
    event.downloadedBytes >= 0 &&
    typeof event.totalBytes === 'number' &&
    Number.isSafeInteger(event.totalBytes) &&
    event.totalBytes >= event.downloadedBytes
  );
};

type SpeedSample = {
  bytes: number;
  atMs: number;
};

export class DownloadSpeedTracker {
  private samples: SpeedSample[] = [];

  constructor(private readonly windowMs = 3_000) {}

  update(bytes: number, atMs: number): number | null {
    const latest = this.samples.at(-1);
    if (latest && (bytes < latest.bytes || atMs < latest.atMs)) {
      this.samples = [];
    }
    this.samples.push({ bytes, atMs });
    const cutoff = atMs - this.windowMs;
    while (this.samples.length > 2 && this.samples[1].atMs <= cutoff) {
      this.samples.shift();
    }
    const first = this.samples[0];
    const elapsedMs = atMs - first.atMs;
    if (elapsedMs <= 0 || bytes <= first.bytes) return null;
    return ((bytes - first.bytes) * 1_000) / elapsedMs;
  }

  reset(): void {
    this.samples = [];
  }
}

const formatBytes = (bytes: number): string => {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1_000)} KB`;
};

const formatSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond >= 1_000_000) {
    return `${(bytesPerSecond / 1_000_000).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSecond / 1_000)} KB/s`;
};

export const formatDownloadProgress = (
  progress: ModelDownloadProgress,
): string => {
  if (progress.phase === 'sizing') return 'Calculating download size';
  if (progress.totalBytes === 0 && progress.phase === 'verifying')
    return 'Verifying installed models';
  if (progress.totalBytes === 0 && progress.phase === 'loading')
    return 'Loading installed models';
  if (progress.phase === 'loading') {
    return `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)} downloaded · Loading models`;
  }
  if (progress.phase === 'verifying') {
    return `${formatBytes(progress.downloadedBytes)} downloaded · Verifying models`;
  }
  const transfer = `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)}`;
  return progress.bytesPerSecond === null
    ? transfer
    : `${transfer} · ${formatSpeed(progress.bytesPerSecond)}`;
};
