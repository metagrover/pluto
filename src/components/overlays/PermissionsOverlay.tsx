interface PermissionsOverlayProps {
    visible: boolean;
    onClose: () => void;
    screenStatus: string;
    micStatus: string;
    onRecheck: () => void;
    onRetry: () => void;
    onOpenSystemSettings: (pane: 'screen' | 'microphone') => void;
}

const statusLabel = (status: string) => {
    if (status === 'authorized' || status === 'granted') return 'Granted'
    if (status === 'denied' || status === 'restricted') return 'Blocked'
    if (status === 'not-determined' || status === 'undetermined') return 'Not Yet'
    return status || 'Unknown'
}

const statusTone = (status: string) => {
    if (status === 'authorized' || status === 'granted') return 'text-emerald-600 bg-emerald-50 border-emerald-200'
    if (status === 'denied' || status === 'restricted') return 'text-rose-600 bg-rose-50 border-rose-200'
    return 'text-amber-700 bg-amber-50 border-amber-200'
}

export const PermissionsOverlay = ({
    visible,
    onClose,
    screenStatus,
    micStatus,
    onRecheck,
    onRetry,
    onOpenSystemSettings
}: PermissionsOverlayProps) => {
    if (!visible) return null

    return (
        <div className="fixed inset-0 z-[1100] flex items-start justify-center pt-24 px-6 animate-in">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md" onClick={onClose} />
            <div className="w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl border border-pro-border overflow-hidden relative scale-in-center">
                <div className="p-10 border-b border-pro-border/40 flex items-center justify-between bg-pro-bg/50">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-2xl border border-pro-border/40 shadow-sm">🔒</div>
                        <div>
                            <h2 className="text-3xl font-black tracking-tighter">Permissions Required</h2>
                            <p className="text-[10px] text-pro-text-muted/60 font-black uppercase tracking-[0.2em] mt-2">
                                System Audio + Microphone
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-12 h-12 rounded-2xl hover:bg-pro-bg transition-all flex items-center justify-center text-sm border border-pro-border/40 shadow-sm active-push group">
                        <span className="text-pro-text-muted group-hover:text-pro-text-main transition-colors font-bold">✕</span>
                    </button>
                </div>

                <div className="p-10 space-y-10">
                    <div className="space-y-4">
                        <p className="text-[13px] text-pro-text-main font-semibold leading-relaxed">
                            Pluto needs system audio access to capture meeting audio and microphone access to capture your voice.
                            Please enable both permissions in macOS System Settings.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="p-6 rounded-[1.5rem] border border-pro-border/40 bg-white shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-[11px] font-black text-pro-text-main uppercase tracking-[0.2em]">Screen & System Audio</h3>
                                <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${statusTone(screenStatus)}`}>
                                    {statusLabel(screenStatus)}
                                </span>
                            </div>
                            <p className="text-[12px] text-pro-text-muted/70 leading-relaxed">
                                System Settings → Privacy & Security → Screen & System Audio Recording.
                            </p>
                            <button
                                onClick={() => onOpenSystemSettings('screen')}
                                className="mt-4 h-10 px-4 rounded-xl border border-pro-border/50 bg-white text-pro-text-main font-black text-[9px] uppercase tracking-[0.2em] hover:border-pro-accent/40 transition-all active-push"
                            >
                                Open System Settings
                            </button>
                        </div>

                        <div className="p-6 rounded-[1.5rem] border border-pro-border/40 bg-white shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-[11px] font-black text-pro-text-main uppercase tracking-[0.2em]">Microphone</h3>
                                <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${statusTone(micStatus)}`}>
                                    {statusLabel(micStatus)}
                                </span>
                            </div>
                            <p className="text-[12px] text-pro-text-muted/70 leading-relaxed">
                                System Settings → Privacy & Security → Microphone.
                            </p>
                            <button
                                onClick={() => onOpenSystemSettings('microphone')}
                                className="mt-4 h-10 px-4 rounded-xl border border-pro-border/50 bg-white text-pro-text-main font-black text-[9px] uppercase tracking-[0.2em] hover:border-pro-accent/40 transition-all active-push"
                            >
                                Open System Settings
                            </button>
                        </div>
                    </div>

                    <div className="p-6 rounded-[1.5rem] border border-pro-border/30 bg-pro-bg/40">
                        <p className="text-[11px] text-pro-text-muted/70 leading-relaxed">
                            After enabling, return here and click Recheck. If both are granted, you can retry recording.
                        </p>
                    </div>

                    <div className="flex items-center justify-between pt-4">
                        <button 
                            onClick={onRecheck}
                            className="h-12 px-6 rounded-2xl border border-pro-border/50 bg-white text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] hover:border-pro-accent/40 transition-all active-push"
                        >
                            Recheck Permissions
                        </button>
                        <div className="flex items-center gap-3">
                            <button 
                                onClick={onClose}
                                className="h-12 px-6 rounded-2xl border border-pro-border/50 bg-white text-pro-text-muted font-black text-[10px] uppercase tracking-[0.2em] hover:text-pro-text-main transition-all active-push"
                            >
                                Close
                            </button>
                            <button 
                                onClick={onRetry}
                                className="h-12 px-8 rounded-2xl bg-pro-text-main text-white font-black text-[10px] uppercase tracking-[0.2em] hover:bg-pro-accent transition-all active-push shadow-premium"
                            >
                                Retry Recording
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
