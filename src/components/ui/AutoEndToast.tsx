interface AutoEndToastProps {
  reason: string | null;
  appName: string | null;
  onReopen: () => void;
  onDismiss: () => void;
}

const getEndReasonDetail = (
  reason: string | null,
  appName: string | null,
): string | null => {
  if (reason === 'call_app_exited') {
    return appName ? `${appName} closed` : 'Call app closed';
  }
  if (reason === 'audio_inactive_timeout') {
    return 'No audio detected';
  }
  if (reason) {
    return appName ? `${appName} closed` : reason;
  }
  return appName ? `${appName} closed` : null;
};

export const AutoEndToast = ({
  reason,
  appName,
  onReopen,
  onDismiss,
}: AutoEndToastProps) => {
  const detail = getEndReasonDetail(reason, appName);

  return (
    <div className="fixed top-8 right-8 z-[2000] animate-in slide-in-from-top-4">
      <div className="flex items-center gap-3 px-3.5 py-2.5 bg-pro-surface/95 backdrop-blur-md rounded-lg border border-pro-border shadow-lg shadow-black/10 text-pro-text-main">
        <div className="w-[34px] h-[34px] rounded-[7px] bg-pro-accent/15 text-pro-accent flex items-center justify-center shrink-0">
          <svg
            className="w-[18px] h-[18px]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap min-w-0 pr-1">
          <span className="text-[13px] font-semibold text-pro-text-main">
            Meeting ended
          </span>
          {detail && (
            <>
              <span className="text-pro-text-muted opacity-40 text-[11px]">•</span>
              <span className="text-[12px] font-medium text-pro-text-muted">
                {detail}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 pl-1 border-l border-pro-border">
          <button
            type="button"
            onClick={onReopen}
            className="h-[30px] px-3 rounded-md bg-pro-accent text-white text-[11px] font-semibold hover:bg-pro-accent/90 transition-all cursor-pointer flex items-center justify-center shadow-sm"
          >
            Reopen
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss meeting ended notification"
            className="w-7 h-7 rounded-md border border-pro-border bg-pro-surface hover:bg-pro-border/20 text-pro-text-muted hover:text-pro-text-main flex items-center justify-center transition-all cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none">
              <path
                d="m6 6 8 8m0-8-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
