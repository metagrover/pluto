interface AutoEndToastProps {
  reason: string | null;
  appName: string | null;
  onReopen: () => void;
  onDismiss: () => void;
}

const getEndReasonDetail = (
  reason: string | null,
  appName: string | null,
): string => {
  if (reason === 'call_app_exited') {
    return appName ? `${appName} closed` : 'Call app closed';
  }
  if (reason === 'audio_inactive_timeout') {
    return 'No audio detected';
  }
  if (reason) {
    return appName ? `${appName} closed` : 'Meeting concluded';
  }
  return appName ? `${appName} closed` : 'Call ended';
};

export const AutoEndToast = ({
  reason,
  appName,
  onReopen,
  onDismiss,
}: AutoEndToastProps) => {
  const detail = getEndReasonDetail(reason, appName);

  return (
    <div className="fixed top-4 right-6 z-[2000] animate-in fade-in slide-in-from-top-3 duration-300">
      <div className="w-[380px] h-[80px] box-border rounded-lg border border-pro-border bg-pro-surface/95 backdrop-blur-md shadow-lg shadow-black/10 flex items-center gap-2.5 px-3 py-2.5 text-pro-text-main">
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
        <div className="flex flex-col min-w-0 pr-1 text-left flex-1">
          <p className="text-[13px] font-semibold text-pro-text-main truncate m-0 leading-[1.2]">
            Meeting ended
          </p>
          <p className="text-[11px] text-pro-text-muted font-medium truncate m-0 leading-[1.2] mt-0.5">
            {detail}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onReopen}
            className="h-[34px] px-3.5 rounded-md bg-pro-accent text-white text-[11px] font-semibold hover:bg-pro-accent/90 active:scale-95 transition-all shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent flex items-center justify-center cursor-pointer"
          >
            Reopen
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss meeting ended notification"
            className="w-7 h-7 rounded-md border border-pro-border bg-pro-surface hover:bg-pro-border/20 text-pro-text-muted hover:text-pro-text-main flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent cursor-pointer"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m6.5 6.5 7 7m0-7-7 7"
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
