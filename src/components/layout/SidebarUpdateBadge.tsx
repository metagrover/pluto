import { ArrowUpRight, Download, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { useAppUpdate } from '../../api/updater';

export const SidebarUpdateBadge = () => {
  const { status, isDownloading, downloadUpdate, openReleaseUrl } =
    useAppUpdate();
  const [isDismissed, setIsDismissed] = useState(false);

  if (!status.hasUpdate || isDismissed) {
    return null;
  }

  const handleUpdate = () => void downloadUpdate();

  return (
    <div
      role="region"
      aria-label="Application update available"
      className="mx-3 mb-2 rounded-lg border border-pro-border/80 bg-pro-bg/60 p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] text-pro-text-main transition-all duration-200"
    >
      {/* Header Row: Indicator + Version + Dismiss */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full bg-pro-accent shrink-0"
            aria-hidden="true"
          />
          <span className="text-[12px] font-semibold text-pro-text-main truncate">
            Pluto {status.latestVersion || 'Update'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="p-1 rounded text-pro-text-muted hover:text-pro-text-main hover:bg-pro-surface transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pro-accent shrink-0"
          title="Dismiss for this session"
          aria-label="Dismiss update notification"
        >
          <X size={12} />
        </button>
      </div>

      {/* Body / Context */}
      <p className="mt-1 text-[11px] leading-normal text-pro-text-muted">
        Download the DMG, quit Pluto, then replace Pluto in Applications.
      </p>

      {/* Primary Action Button */}
      <div className="mt-2.5 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={handleUpdate}
          disabled={isDownloading}
          className="h-7 w-full rounded-md bg-pro-text-main text-pro-bg text-[11px] font-medium transition-opacity hover:opacity-90 active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
        >
          {isDownloading ? (
            <>
              <RefreshCw size={12} className="animate-spin" />
              <span>Opening download...</span>
            </>
          ) : (
            <>
              <Download size={12} />
              <span>Download update</span>
            </>
          )}
        </button>

        <div className="flex items-center justify-end pt-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => openReleaseUrl(status.releaseUrl)}
            className="inline-flex items-center gap-0.5 text-pro-text-muted hover:text-pro-text-main transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pro-accent rounded px-0.5"
            title="View release details on GitHub"
          >
            <span>Release notes</span>
            <ArrowUpRight size={10} />
          </button>
        </div>
      </div>
    </div>
  );
};
