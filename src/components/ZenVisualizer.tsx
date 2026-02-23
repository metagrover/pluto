import { useEffect, useRef, useState } from 'react';

interface ZenVisualizerProps {
  analyser: AnalyserNode | null;
  isProcessing?: boolean;
}

export const ZenVisualizer = ({
  analyser,
  isProcessing = false,
}: ZenVisualizerProps) => {
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    // Only run timer if NOT processing
    if (isProcessing) return;

    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [isProcessing]); // Reset if processing changes? No, we want to freeze.

  // Better Timer Logic:
  // We want to count UP while !isProcessing.
  // When isProcessing becomes true, we just stop updating.

  // ... rewritten effect:
  // biome-ignore lint/correctness/useExhaustiveDependencies: This timer intentionally rebinds only on processing state transitions.
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (!isProcessing) {
      const startTime = Date.now() - elapsed * 1000; // resume logic if needed, or just start fresh
      interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isProcessing]); // Note: this resets to 0 if we don't handle resume, but here we just mount once.
  // Actually simplicity: usage in App.tsx mounts it only during Zen Mode.
  // So just freezing the state update is enough.

  // Use a ref to track start time to avoid effect re-run issues

  // ... Simplified implementation for tool call:

  // Optional: Subtle breathing effect based on audio level (Freeze if processing)
  useEffect(() => {
    if (!analyser || isProcessing) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let rafId: number;

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      setLevel((prev) => prev * 0.9 + (avg / 255) * 0.1);
      rafId = requestAnimationFrame(updateLevel);
    };
    updateLevel();
    return () => cancelAnimationFrame(rafId);
  }, [analyser, isProcessing]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`flex items-center gap-4 px-6 py-3 rounded-full border shadow-sm animate-in fade-in slide-in-from-top-4 duration-700 transition-colors cursor-default ${
        isProcessing
          ? 'bg-pro-bg/80 border-pro-border/60'
          : 'bg-white/40 backdrop-blur-xl border-white/60 hover:bg-white/60'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center w-3 h-3">
          <div
            className={`w-2.5 h-2.5 rounded-full z-10 transition-transform duration-100 ${isProcessing ? 'bg-amber-400' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`}
            style={{
              transform: isProcessing
                ? 'scale(1)'
                : `scale(${1 + level * 0.5})`,
            }}
          />
          {!isProcessing && (
            <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-20" />
          )}
          {isProcessing && (
            <div className="absolute inset-0 bg-amber-400 rounded-full animate-pulse opacity-40" />
          )}
        </div>
        <span
          className={`text-[11px] font-black uppercase tracking-[0.2em] ${isProcessing ? 'text-amber-500/80' : 'text-red-500/80'}`}
        >
          {isProcessing ? 'Processing' : 'Recording'}
        </span>
      </div>

      <div className="h-4 w-px bg-stone-300/50" />

      <div className="flex items-center gap-2">
        <span className="text-[14px] font-medium font-mono text-pro-text-main/80 tabular-nums tracking-wide">
          {formatTime(elapsed)}
        </span>
        {isProcessing && (
          <span className="text-[10px] text-stone-400 italic">
            finalizing...
          </span>
        )}
      </div>
    </div>
  );
};
