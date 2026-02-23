import { useEffect, useMemo, useRef } from 'react';

const LIFETIME_MS = 15_000;

const getAlertAppName = () => {
  const params = new URLSearchParams(window.location.search);
  const rawName = params.get('appName');
  const normalized = typeof rawName === 'string' ? rawName.trim() : '';
  return normalized || 'Call';
};

export const ActiveCallAlertWindow = () => {
  const appName = useMemo(getAlertAppName, []);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const isPausedRef = useRef(false);
  const pausedAtRef = useRef(0);
  const deadlineTsRef = useRef(Date.now() + LIFETIME_MS);

  const closeAlert = () => window.close();

  const updateProgress = () => {
    const now = Date.now();
    const remainingMs = Math.max(0, deadlineTsRef.current - now);
    const ratio = Math.max(0, Math.min(1, remainingMs / LIFETIME_MS));
    if (progressBarRef.current) {
      progressBarRef.current.style.transform = `scaleX(${ratio})`;
    }

    if (remainingMs <= 0) {
      closeAlert();
      return;
    }

    if (isPausedRef.current) return;
    rafRef.current = window.requestAnimationFrame(updateProgress);
  };

  const pauseCountdown = () => {
    if (isPausedRef.current) return;
    isPausedRef.current = true;
    pausedAtRef.current = Date.now();
    window.cancelAnimationFrame(rafRef.current);
    updateProgress();
  };

  const resumeCountdown = () => {
    if (!isPausedRef.current) return;
    isPausedRef.current = false;
    const pausedDuration = Date.now() - pausedAtRef.current;
    deadlineTsRef.current += pausedDuration;
    pausedAtRef.current = 0;
    window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(updateProgress);
  };

  const handleTakeNotes = () => {
    window.cancelAnimationFrame(rafRef.current);
    window.ipcRenderer.send('ACTIVE_CALL_ALERT_ACTION', {
      action: 'take-notes',
      appName,
    });
    window.close();
  };

  useEffect(() => {
    rafRef.current = window.requestAnimationFrame(updateProgress);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.cancelAnimationFrame(rafRef.current);
        window.close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(rafRef.current);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div
      className="active-call-alert"
      onMouseEnter={pauseCountdown}
      onMouseLeave={resumeCountdown}
    >
      <button
        type="button"
        className="close-alert"
        aria-label="Close alert"
        onClick={closeAlert}
      >
        ×
      </button>
      <div className="left-block">
        <div className="meta">
          <p className="title">Call detected</p>
          <div className="app-row">
            <p className="app">{appName}</p>
          </div>
        </div>
      </div>
      <div className="actions">
        <button type="button" className="take-notes" onClick={handleTakeNotes}>
          Take Notes
        </button>
      </div>
      <div className="progress-track">
        <div ref={progressBarRef} className="progress-bar" />
      </div>
    </div>
  );
};
