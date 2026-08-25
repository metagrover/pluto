import type { ModelDownloadProgress as ModelDownloadProgressValue } from '../services/modelDownloadProgress';
import { formatDownloadProgress } from '../services/modelDownloadProgress';

export const ModelDownloadProgress = ({
  progress,
}: {
  progress: ModelDownloadProgressValue | null;
}) => {
  if (!progress) {
    return (
      <div className="h-1.5 overflow-hidden rounded-full bg-pro-bg">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-pro-accent" />
      </div>
    );
  }

  const determinate = progress.totalBytes > 0;
  const percentage = determinate
    ? Math.round((progress.downloadedBytes / progress.totalBytes) * 100)
    : 0;

  return (
    <div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-pro-bg"
        role={determinate ? 'progressbar' : undefined}
        aria-label="Local transcription model download"
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? percentage : undefined}
      >
        <div
          className={`h-full rounded-full bg-pro-accent transition-[width] duration-200 ease-out ${determinate ? '' : 'w-2/3 animate-pulse'}`}
          style={determinate ? { width: `${percentage}%` } : undefined}
        />
      </div>
      <p className="mt-2 text-[11px] tabular-nums text-pro-text-muted">
        {formatDownloadProgress(progress)}
      </p>
    </div>
  );
};
