interface PermissionsOverlayProps {
  visible: boolean;
  onClose: () => void;
  micStatus: string;
  systemAudioStatus: string;
  onRetry: () => void;
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
  onOpenSystemSettings,
}: PermissionsOverlayProps) => {
  const bothGranted =
    isGrantedStatus(micStatus) && isGrantedStatus(systemAudioStatus);
  if (!visible || bothGranted) return null;

  const handleCheckAgain = () => {
    onRetry();
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-start justify-center pt-32 px-6 animate-in">
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-2xl border border-pro-border overflow-hidden relative scale-in-center">
        <div className="p-8 border-b border-pro-border/40 flex items-center justify-between bg-pro-bg/50">
          <div className="flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-xl border border-pro-border/40 shadow-sm">
              🔒
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tighter">
                Permissions Required
              </h2>
              <p className="text-[10px] text-pro-text-muted/60 font-black uppercase tracking-[0.2em] mt-1.5">
                Access Needed
              </p>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8">
          <div className="space-y-4">
            <p className="text-[13px] text-pro-text-main font-medium leading-relaxed">
              Pluto needs microphone and system audio access to capture your
              meetings. Please enable them in System Settings to continue.
            </p>
          </div>

          <div className="p-6 rounded-[1.5rem] border border-pro-border/40 bg-white shadow-sm ring-4 ring-pro-bg/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-black text-pro-text-main uppercase tracking-[0.2em]">
                Microphone
              </h3>
              <span
                className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${statusTone(micStatus)}`}
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
              className="w-full h-10 rounded-xl border border-pro-border/50 bg-pro-bg/50 text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] hover:bg-white hover:border-pro-accent/40 transition-all active-push"
            >
              Open System Settings
            </button>
          </div>

          <div className="p-6 rounded-[1.5rem] border border-pro-border/40 bg-white shadow-sm ring-4 ring-pro-bg/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-black text-pro-text-main uppercase tracking-[0.2em]">
                System Audio
              </h3>
              <span
                className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${statusTone(systemAudioStatus)}`}
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
              className="w-full h-10 rounded-xl border border-pro-border/50 bg-pro-bg/50 text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] hover:bg-white hover:border-pro-accent/40 transition-all active-push"
            >
              Open System Settings
            </button>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 rounded-2xl border border-pro-border/50 bg-white text-pro-text-muted font-black text-[10px] uppercase tracking-[0.2em] hover:text-pro-text-main transition-all active-push"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCheckAgain}
              className="flex-[2] h-12 rounded-2xl bg-pro-text-main text-white font-black text-[10px] uppercase tracking-[0.2em] hover:bg-pro-accent transition-all active-push shadow-premium"
            >
              Restart App
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
