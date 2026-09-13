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
      className="fixed top-4 right-6 z-50 flex items-center gap-2.5 bg-pro-surface/95 backdrop-blur-md border border-pro-border shadow-lg shadow-black/10 text-pro-text-main px-3 py-2.5 rounded-lg animate-in fade-in slide-in-from-top-3 duration-300 w-[380px] box-border"
    >
      <div className="flex items-center justify-center w-[34px] h-[34px] rounded-[7px] bg-pro-accent/15 text-pro-accent shrink-0">
        <Icon className="w-[18px] h-[18px]" />
      </div>

      <div className="flex flex-col min-w-0 pr-1 text-left flex-1">
        <div className="text-[13px] font-semibold text-pro-text-main truncate">
          {event.title || 'Upcoming Meeting'}
        </div>
        <div className="text-[11px] text-pro-text-muted flex items-center gap-1 font-medium truncate">
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

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onStartRecording(event)}
          className="flex items-center gap-1.5 bg-pro-accent hover:bg-pro-accent/90 active:scale-95 text-white text-[11px] font-semibold h-[34px] px-3 rounded-md transition-all shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          <span>Record</span>
        </button>

        <button
          type="button"
          aria-label="Dismiss meeting prompt"
          onClick={() => onDismiss(event.occurrenceKey)}
          className="w-7 h-7 flex items-center justify-center text-pro-text-muted hover:text-pro-text-main rounded-md border border-pro-border bg-pro-surface hover:bg-pro-border/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
};
