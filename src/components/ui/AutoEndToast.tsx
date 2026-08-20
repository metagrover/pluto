interface AutoEndToastProps {
  reason: string | null;
  appName: string | null;
  onReopen: () => void;
  onDismiss: () => void;
}

const reasonLabels: Record<string, string> = {
  call_app_exited: 'Call app closed',
  audio_inactive_timeout: 'No audio detected',
};

export const AutoEndToast = ({
  reason,
  appName,
  onReopen,
  onDismiss,
}: AutoEndToastProps) => {
  const label = reason ? reasonLabels[reason] || reason : 'Call ended';
  const detail = appName ? `${appName} — ${label}` : label;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[2000] animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-4 px-6 py-4 bg-white rounded-md border border-pro-border shadow-sm">
        <div className="w-10 h-10 rounded-md bg-pro-accent/10 flex items-center justify-center shrink-0">
          <svg
            className="w-5 h-5 text-pro-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-semibold text-pro-text-main">
            Meeting ended automatically
          </span>
          <span className="text-[11px] text-pro-text-muted/60 font-bold truncate">
            {detail}
          </span>
        </div>
        <div className="flex items-center gap-2 ml-4 shrink-0">
          <button
            type="button"
            onClick={onReopen}
            className="h-9 px-5 rounded-md bg-pro-accent text-white text-[11px] font-medium hover:bg-pro-accent/90 transition-all "
          >
            Reopen
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="h-9 w-9 rounded-md border border-pro-border/40 bg-pro-bg flex items-center justify-center text-pro-text-muted hover:bg-pro-bg transition-all "
          >
            <span className="text-xs font-bold">✕</span>
          </button>
        </div>
      </div>
    </div>
  );
};
