import { CalendarPlus, Check, ChevronDown, Mic } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../../../../electron/calendar/types';
import {
  getPrepsForNote,
  openMeetingPrep,
  saveMeetingPrep,
} from '../../../api/meetingPrep';
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

/**
 * "Meeting" in a note's header: start a meeting with this note as its notes,
 * or use the note as the prep for an upcoming calendar meeting. Prep links to
 * the note, so later edits to the note show in the prep.
 */
export const NoteMeetingMenu = ({
  noteId,
  title,
  content,
  personName,
  events,
  onStartMeeting,
}: {
  /** The saved note; without it the note cannot be linked to prep yet. */
  noteId?: string | null;
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
  const [linkedKeys, setLinkedKeys] = useState<string[]>([]);
  const upcoming = noteId ? upcomingForPrep(events) : [];
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 5000);
    return () => clearTimeout(timer);
  }, [status]);

  const loadLinks = useCallback(() => {
    if (!noteId) {
      setLinkedKeys([]);
      return;
    }
    void Promise.resolve(getPrepsForNote(noteId))
      .then((preps) =>
        setLinkedKeys(
          Array.isArray(preps) ? preps.map((prep) => prep.occurrenceKey) : [],
        ),
      )
      .catch(() => setLinkedKeys([]));
  }, [noteId]);
  useEffect(() => {
    loadLinks();
    const off = window.ipcRenderer?.on?.('meeting-prep:updated', loadLinks);
    return () => {
      if (typeof off === 'function') off();
    };
  }, [loadLinks]);

  if (!onStartMeeting && !upcoming.length) return null;
  const close = () => {
    if (menuRef.current) menuRef.current.open = false;
  };
  const linkedUpcoming = upcoming.filter((event) =>
    linkedKeys.includes(event.occurrenceKey),
  );

  const togglePrep = async (event: CalendarEvent) => {
    if (!noteId) return;
    const linked = linkedKeys.includes(event.occurrenceKey);
    const name = event.title || 'the meeting';
    setBusy(true);
    try {
      const prep = await openMeetingPrep(event);
      await saveMeetingPrep(
        prep,
        linked ? { removeNoteId: noteId } : { addNoteId: noteId },
      );
      setLinkedKeys((keys) =>
        linked
          ? keys.filter((key) => key !== event.occurrenceKey)
          : [...keys, event.occurrenceKey],
      );
      setStatus(
        linked
          ? `No longer used for ${name}`
          : `This note is now the prep for ${name}`,
      );
    } catch {
      setStatus(
        linked
          ? 'Could not remove this note from the meeting’s prep.'
          : 'Could not use this note for the meeting’s prep.',
      );
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
          <span className="max-w-48 truncate">
            {linkedUpcoming.length
              ? `For ${linkedUpcoming[0].title || 'a meeting'}${linkedUpcoming.length > 1 ? ` +${linkedUpcoming.length - 1}` : ''}`
              : 'Meeting'}
          </span>
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
                Use as prep for
              </p>
              {upcoming.map((event) => (
                <button
                  key={event.occurrenceKey}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={linkedKeys.includes(event.occurrenceKey)}
                  disabled={busy}
                  className={itemClass}
                  onClick={() => void togglePrep(event)}
                >
                  <span className="flex w-3.5 shrink-0 justify-center">
                    {linkedKeys.includes(event.occurrenceKey) ? (
                      <Check size={14} aria-hidden="true" />
                    ) : null}
                  </span>
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
