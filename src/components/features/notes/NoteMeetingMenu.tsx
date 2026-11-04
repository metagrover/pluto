import { CalendarPlus, ChevronDown, Mic } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../../../../electron/calendar/types';
import { openMeetingPrep, saveMeetingPrep } from '../../../api/meetingPrep';
import type { MeetingStartContext } from '../../../types/meetingStart';
import { DetailsMenu } from '../../ui/DetailsMenu';

const itemClass =
  'flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-pro-text-main hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40';

const whenLabel = (start: string): string =>
  new Date(start).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Upcoming calendar meetings that can still take prep, soonest first. */
export const upcomingForPrep = (
  events: ReadonlyArray<object>,
  now = Date.now(),
): CalendarEvent[] =>
  (events as Array<Partial<CalendarEvent>>)
    .filter(
      (event): event is CalendarEvent =>
        typeof event.occurrenceKey === 'string' &&
        typeof event.start === 'string' &&
        typeof event.end === 'string' &&
        !event.isCancelled &&
        Date.parse(event.end) > now,
    )
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 5);

/** Adds a note's text to a meeting's prep notes, once. */
export const prepNotesWith = (existing: string, noteText: string): string => {
  const addition = noteText.trim();
  if (!addition || existing.includes(addition)) return existing;
  return existing.trim() ? `${existing.trimEnd()}\n\n${addition}` : addition;
};

/**
 * "Meeting" in a note's header: start a meeting with this note as its notes,
 * or put the note into the prep for an upcoming calendar meeting.
 */
export const NoteMeetingMenu = ({
  title,
  content,
  personName,
  events,
  onStartMeeting,
}: {
  title: string;
  content: string;
  personName: string | null;
  /** Calendar events as listed by the calendar; only usable ones are offered. */
  events: ReadonlyArray<object>;
  onStartMeeting?: (start: MeetingStartContext) => void;
}) => {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upcoming = upcomingForPrep(events);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 5000);
    return () => clearTimeout(timer);
  }, [status]);

  if (!onStartMeeting && !upcoming.length) return null;
  const close = () => {
    if (menuRef.current) menuRef.current.open = false;
  };

  const addToPrep = async (event: CalendarEvent) => {
    setBusy(true);
    try {
      const prep = await openMeetingPrep(event);
      const notes = prepNotesWith(prep.notes || '', content);
      if (notes !== (prep.notes || '')) await saveMeetingPrep(prep, { notes });
      setStatus(`Added to the prep for ${event.title || 'the meeting'}`);
    } catch {
      setStatus('Could not add this note to the meeting’s prep.');
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <div className="flex items-center gap-2">
      {status ? (
        <output className="text-[12px] text-pro-text-muted" aria-live="polite">
          {status}
        </output>
      ) : null}
      <DetailsMenu ref={menuRef} className="relative">
        <summary
          className="note-ask-trigger cursor-pointer list-none [&::-webkit-details-marker]:hidden"
          aria-label="Use this note for a meeting"
        >
          <CalendarPlus size={14} aria-hidden="true" />
          <span>Meeting</span>
          <ChevronDown size={12} aria-hidden="true" />
        </summary>
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-pro-border bg-pro-bg p-1 shadow-lg">
          {onStartMeeting ? (
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close();
                onStartMeeting({
                  title: title.trim() || 'Meeting',
                  participants: personName ? [personName] : [],
                  notes: content,
                });
              }}
            >
              <Mic size={14} aria-hidden="true" />
              Start meeting now
            </button>
          ) : null}
          {upcoming.length ? (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-pro-text-muted">
                Add to the prep for
              </p>
              {upcoming.map((event) => (
                <button
                  key={event.occurrenceKey}
                  type="button"
                  disabled={busy}
                  className={itemClass}
                  onClick={() => void addToPrep(event)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {event.title || 'Untitled meeting'}
                  </span>
                  <span className="shrink-0 text-xs text-pro-text-muted">
                    {whenLabel(event.start)}
                  </span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      </DetailsMenu>
    </div>
  );
};
