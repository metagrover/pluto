import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import plutoLogo from '../../assets/brand/pluto_logo.svg?inline';
import plutoLogoDark from '../../assets/brand/pluto_logo_dark_mode.svg?inline';
import { formatRelativeStartTime } from '../../utils/relativeStartTime';

const LIFETIME_MS = 15_000;

type AlertData =
  | {
      type: 'call';
      appName: string;
    }
  | {
      type: 'calendar';
      occurrenceKey: string;
      title: string;
      start: string;
      hasLink: boolean;
      attendees?: number;
    };

// Match App's persisted theme aliases; use the same CSS tokens in this window.
const resolveAlertTheme = (
  systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches,
): string => {
  const selected =
    new URLSearchParams(window.location.search).get('theme') || 'system';
  if (selected === 'system') return systemDark ? 'dark' : 'light';
  if (['coral', 'airbnb', 'pluto-site'].includes(selected)) return 'pluto-site';
  if (['slack', 'aubergine'].includes(selected)) return 'aubergine';
  if (['claude', 'celestial', 'botanical', 'terracotta'].includes(selected))
    return 'terracotta';
  return ['light', 'dark', 'midnight', 'paper'].includes(selected)
    ? selected
    : 'light';
};

const getAlertData = (): AlertData => {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');

  if (type === 'calendar') {
    const rawTitle = params.get('title');
    const title =
      typeof rawTitle === 'string' && rawTitle.trim()
        ? rawTitle.trim()
        : 'Upcoming Meeting';
    const rawOccurrenceKey = params.get('occurrenceKey');
    const occurrenceKey =
      typeof rawOccurrenceKey === 'string' ? rawOccurrenceKey : '';
    const rawStart = params.get('start');
    const start =
      typeof rawStart === 'string' && rawStart
        ? rawStart
        : new Date().toISOString();
    const hasLink = params.get('hasLink') === 'true';
    const rawAttendees = params.get('attendees');
    const attendees = rawAttendees
      ? Number.parseInt(rawAttendees, 10)
      : undefined;

    return {
      type: 'calendar',
      occurrenceKey,
      title,
      start,
      hasLink,
      attendees: Number.isFinite(attendees) ? attendees : undefined,
    };
  }

  const rawName = params.get('appName');
  const normalized = typeof rawName === 'string' ? rawName.trim() : '';
  return {
    type: 'call',
    appName: normalized || 'Call',
  };
};

export const ActiveCallAlertWindow = () => {
  const alertData = useMemo(getAlertData, []);
  const [theme, setTheme] = useState(() => resolveAlertTheme());
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const next = resolveAlertTheme(media.matches);
      document.documentElement.className = next;
      document.documentElement.style.colorScheme =
        next === 'dark' ? 'dark' : 'light';
      setTheme(next);
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, []);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const isPausedRef = useRef(false);
  const pausedAtRef = useRef(0);
  const deadlineTsRef = useRef(Date.now() + LIFETIME_MS);

  const [relativeTime, setRelativeTime] = useState(() =>
    alertData.type === 'calendar'
      ? formatRelativeStartTime(alertData.start)
      : '',
  );

  useEffect(() => {
    if (alertData.type !== 'calendar') return;
    setRelativeTime(formatRelativeStartTime(alertData.start));
    const interval = setInterval(() => {
      setRelativeTime(formatRelativeStartTime(alertData.start));
    }, 15000);
    return () => clearInterval(interval);
  }, [alertData]);

  const handleDismiss = useCallback(() => {
    window.cancelAnimationFrame(rafRef.current);
    if (alertData.type === 'calendar') {
      window.ipcRenderer?.send('CALENDAR_PROMPT_ALERT_ACTION', {
        action: 'dismiss',
        occurrenceKey: alertData.occurrenceKey,
      });
    }
    window.close();
  }, [alertData]);

  const updateProgress = useCallback(() => {
    const now = Date.now();
    const remainingMs = Math.max(0, deadlineTsRef.current - now);
    const ratio = Math.max(0, Math.min(1, remainingMs / LIFETIME_MS));
    if (progressBarRef.current) {
      progressBarRef.current.style.transform = `scaleX(${ratio})`;
    }

    if (remainingMs <= 0) {
      handleDismiss();
      return;
    }

    if (isPausedRef.current) return;
    rafRef.current = window.requestAnimationFrame(updateProgress);
  }, [handleDismiss]);

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
    window.ipcRenderer?.send('ACTIVE_CALL_ALERT_ACTION', {
      action: 'take-notes',
      appName: alertData.type === 'call' ? alertData.appName : undefined,
    });
    window.close();
  };

  const handleStartRecording = () => {
    window.cancelAnimationFrame(rafRef.current);
    if (alertData.type === 'calendar') {
      window.ipcRenderer?.send('CALENDAR_PROMPT_ALERT_ACTION', {
        action: 'record',
        occurrenceKey: alertData.occurrenceKey,
      });
    }
    window.close();
  };

  const handlePrepare = () => {
    window.cancelAnimationFrame(rafRef.current);
    if (alertData.type === 'calendar') {
      window.ipcRenderer?.send('CALENDAR_PROMPT_ALERT_ACTION', {
        action: 'prepare',
        occurrenceKey: alertData.occurrenceKey,
      });
    }
    window.close();
  };

  useEffect(() => {
    rafRef.current = window.requestAnimationFrame(updateProgress);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(rafRef.current);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDismiss, updateProgress]);

  const isCalendar = alertData.type === 'calendar';

  return (
    <div
      className={`active-call-alert active-call-alert--${isCalendar ? 'calendar' : 'call'} alert-theme--${theme}`}
      onMouseEnter={pauseCountdown}
      onMouseLeave={resumeCountdown}
    >
      <div className="status-icon" aria-hidden="true">
        {isCalendar ? (
          alertData.hasLink ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11" />
              <rect x="2" y="6" width="14" height="12" rx="2" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          )
        ) : (
          <img
            className="pluto-status-logo"
            src={theme === 'dark' ? plutoLogoDark : plutoLogo}
            alt=""
          />
        )}
      </div>
      <div className="left-block">
        <div className="meta">
          <p className="title" title={isCalendar ? alertData.title : undefined}>
            {isCalendar ? alertData.title : 'Call detected'}
          </p>
          {isCalendar ? (
            <div className="subtitle-row">
              <span>{relativeTime}</span>
              {alertData.attendees !== undefined && alertData.attendees > 0 && (
                <>
                  <span className="dot-sep">•</span>
                  <span>
                    {alertData.attendees} attendee
                    {alertData.attendees > 1 ? 's' : ''}
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="app-row">
              <p className="app" title={alertData.appName}>
                {alertData.appName}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="actions">
        {isCalendar ? (
          <>
            <button
              type="button"
              className="prepare-brief"
              onClick={handlePrepare}
            >
              Prep
            </button>
            <button
              type="button"
              className="take-notes"
              onClick={handleStartRecording}
            >
              <span className="record-dot" aria-hidden="true" />
              <span>Record</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="take-notes"
            onClick={handleTakeNotes}
          >
            Take notes
          </button>
        )}
      </div>
      <button
        type="button"
        className="close-alert"
        aria-label={
          isCalendar ? 'Dismiss meeting prompt' : 'Dismiss call detected alert'
        }
        onClick={handleDismiss}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="m6.5 6.5 7 7m0-7-7 7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div className="progress-track">
        <div ref={progressBarRef} className="progress-bar" />
      </div>
    </div>
  );
};
