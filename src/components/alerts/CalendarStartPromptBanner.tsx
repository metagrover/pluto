import { Calendar, Video, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import type { CalendarEvent } from '../../../electron/calendar/types';
import { hasConferenceLink } from '../../utils/conferenceUrl';

interface CalendarStartPromptBannerProps {
  event: CalendarEvent;
  onStartRecording: (event: CalendarEvent) => void;
  onDismiss: (occurrenceKey: string) => void;
}

const formatRelativeStartTime = (isoStart: string): string => {
  const startMs = new Date(isoStart).getTime();
  const diffMs = startMs - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);

  if (Math.abs(diffMinutes) <= 1) {
    return 'Starts now';
  }
  if (diffMinutes > 1) {
    return `Starts in ${diffMinutes}m`;
  }
  return `Started ${Math.abs(diffMinutes)}m ago`;
};

export const CalendarStartPromptBanner: React.FC<
  CalendarStartPromptBannerProps
> = ({ event, onStartRecording, onDismiss }) => {
  const [relativeTime, setRelativeTime] = useState(() =>
    formatRelativeStartTime(event.start),
  );

  useEffect(() => {
    setRelativeTime(formatRelativeStartTime(event.start));
    const interval = setInterval(() => {
      setRelativeTime(formatRelativeStartTime(event.start));
    }, 15000);
    return () => clearInterval(interval);
  }, [event.start]);

  const hasLink = hasConferenceLink(event);
  const Icon = hasLink ? Video : Calendar;

  return (
    <section
      aria-label="Upcoming meeting prompt"
      className="fixed top-4 right-6 z-50 flex items-center gap-3 bg-pro-surface/95 backdrop-blur-md border border-pro-border/80 shadow-lg shadow-black/10 text-pro-text-main px-4 py-2.5 rounded-full animate-in fade-in slide-in-from-top-3 duration-300 max-w-[480px]"
    >
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-pro-accent/15 text-pro-accent shrink-0">
        <Icon className="w-3.5 h-3.5" />
      </div>

      <div className="flex flex-col min-w-0 pr-1 text-left">
        <div className="text-[13px] font-semibold text-pro-text-main truncate max-w-[220px]">
          {event.title || 'Upcoming Meeting'}
        </div>
        <div className="text-[11px] text-pro-text-muted flex items-center gap-1.5 font-medium">
          <span>{relativeTime}</span>
          {event.attendees && event.attendees.length > 0 && (
            <>
              <span className="opacity-40">•</span>
              <span>
                {event.attendees.length} attendee
                {event.attendees.length > 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 pl-1 border-l border-pro-border/60">
        <button
          type="button"
          onClick={() => onStartRecording(event)}
          className="flex items-center gap-1.5 bg-pro-accent hover:bg-pro-accent/90 active:scale-95 text-white text-[12px] font-semibold px-3 py-1.5 rounded-full transition-all shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
        >
          <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
          <span>Record</span>
        </button>

        <button
          type="button"
          aria-label="Dismiss meeting prompt"
          onClick={() => onDismiss(event.occurrenceKey)}
          className="p-1 text-pro-text-muted hover:text-pro-text-main rounded-full hover:bg-pro-border/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
};
