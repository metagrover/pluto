interface PermissionsOverlayProps {
  visible: boolean;
  onClose: () => void;
  micStatus: string;
  systemAudioStatus: string;
  onRetry: () => void;
  onRestart: () => void;
  onOpenSystemSettings: (pane: 'microphone' | 'system-audio') => void;
}

const isGrantedStatus = (status: string) =>
  status === 'authorized' || status === 'granted';

const statusLabel = (status: string) => {
  if (isGrantedStatus(status)) return 'Granted';
  if (status === 'denied' || status === 'restricted') return 'Blocked';
  if (status === 'needs-audio') return 'Verify';
  if (status === 'not-determined' || status === 'undetermined')
    return 'Check Settings';
  return status || 'Unknown';
};

const statusTone = (status: string) => {
  if (isGrantedStatus(status))
    return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  if (status === 'denied' || status === 'restricted')
    return 'text-rose-600 bg-rose-50 border-rose-200';
  if (status === 'needs-audio')
    return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-amber-700 bg-amber-50 border-amber-200';
};

export const PermissionsOverlay = ({
  visible,
  onClose,
  micStatus,
  systemAudioStatus,
  onRetry,
  onRestart,
  onOpenSystemSettings,
}: PermissionsOverlayProps) => {
  const bothGranted =
    isGrantedStatus(micStatus) && isGrantedStatus(systemAudioStatus);
  const microphoneBlocked =
    micStatus === 'denied' || micStatus === 'restricted';
  if (!visible || bothGranted) return null;

  const handleCheckAgain = () => {
    onRetry();
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-6 animate-in">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="permissions-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-pro-border bg-pro-surface shadow-2xl scale-in-center"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 p-6 border-b border-pro-border/40 flex items-center justify-between gap-4 bg-pro-bg">
          <div className="flex items-center gap-5">
            <div className="w-12 h-12 rounded-md bg-pro-surface flex items-center justify-center text-xl border border-pro-border/40 shadow-sm">
              🔒
            </div>
            <div>
              <h2 id="permissions-title" className="text-xl font-semibold">
                Permissions Required
              </h2>
              <p className="text-[10px] text-pro-text-muted/60 font-medium mt-1.5">
                Access Needed
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close permissions dialog"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="flex h-8 w-11 items-center justify-center rounded-md border border-pro-border/60 bg-pro-surface text-pro-text-muted transition-all hover:bg-pro-bg hover:text-pro-text-main"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain p-6 space-y-6">
          <div className="space-y-4">
            <p className="text-[13px] text-pro-text-main font-medium leading-relaxed">
              Pluto needs microphone and system audio access to capture your
              meetings. Please enable them in System Settings to continue.
            </p>
          </div>

          <div className="p-6 rounded-lg border border-pro-border/40 bg-pro-surface shadow-sm ring-4 ring-pro-bg/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-semibold text-pro-text-main font-medium">
                Microphone
              </h3>
              <span
                className={`text-[10px] font-medium px-3 py-1 rounded-full border ${statusTone(micStatus)}`}
              >
                {statusLabel(micStatus)}
              </span>
            </div>
            <p className="text-[12px] text-pro-text-muted/70 leading-relaxed mb-5">
              System Settings → Privacy & Security → Microphone.
            </p>
            <button
              type="button"
              onClick={() => onOpenSystemSettings('microphone')}
              className="w-full h-10 rounded-md border border-pro-border/50 bg-pro-bg text-pro-text-main font-semibold text-[10px] font-medium hover:bg-pro-surface hover:border-pro-accent/40 transition-all "
            >
              Open System Settings
            </button>
          </div>

          <div className="p-6 rounded-lg border border-pro-border/40 bg-pro-surface shadow-sm ring-4 ring-pro-bg/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-semibold text-pro-text-main font-medium">
                System Audio
              </h3>
              <span
                className={`text-[10px] font-medium px-3 py-1 rounded-full border ${statusTone(systemAudioStatus)}`}
              >
                {statusLabel(systemAudioStatus)}
              </span>
            </div>
            <p className="text-[12px] text-pro-text-muted/70 leading-relaxed mb-5">
              System Settings → Privacy & Security → Screen &amp; System Audio
              Recording → System Audio Recording Only.
            </p>
            <button
              type="button"
              onClick={() => onOpenSystemSettings('system-audio')}
              className="w-full h-10 rounded-md border border-pro-border/50 bg-pro-bg text-pro-text-main font-semibold text-[10px] font-medium hover:bg-pro-surface hover:border-pro-accent/40 transition-all "
            >
              Open System Settings
            </button>
          </div>
          {microphoneBlocked && (
            <p className="text-[12px] leading-relaxed text-pro-text-muted">
              If you enabled a previously blocked microphone in System Settings,
              macOS requires restarting Pluto.{' '}
              <button
                type="button"
                onClick={onRestart}
                className="font-semibold text-pro-accent underline underline-offset-2"
              >
                Restart Pluto
              </button>
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-3 border-t border-pro-border/40 bg-pro-bg p-6">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="flex-1 h-12 rounded-md border border-pro-border/50 bg-pro-surface text-pro-text-muted font-semibold text-[10px] font-medium hover:text-pro-text-main transition-all "
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCheckAgain}
            className="flex-[2] h-12 rounded-md bg-pro-text-main dark:bg-pro-accent text-white font-semibold text-[10px] font-medium hover:bg-pro-accent transition-all  shadow-sm"
          >
            Check again
          </button>
        </div>
      </div>
    </div>
  );
};
