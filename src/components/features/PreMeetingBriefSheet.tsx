import { ArrowLeft, Loader2, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CalendarEvent } from '../../../electron/calendar/types';
import type { MeetingPrep } from '../../../electron/meetingPrep';
import { prepStartBlocker } from '../../../electron/meetingPrep';
import { openMeetingPrep } from '../../api/meetingPrep';
import { formatPrepDate } from '../../utils/meetingPrepPresentation';
import { MeetingPrepBriefSkeleton } from './MeetingPrepBrief';
import {
  MeetingPrepEditor,
  type MeetingPrepEditorHandle,
} from './MeetingPrepEditor';
function agendaMarkdown(text: string): string {
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  const document = new DOMParser().parseFromString(text, 'text/html');
  document.querySelectorAll('script, style').forEach((node) => node.remove());
  document.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href') || '';
    const label = anchor.textContent || href;
    anchor.replaceWith(
      /^https?:\/\//i.test(href) ? `${label} (${href})` : label,
    );
  });
  document.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  document.querySelectorAll('p, div, li').forEach((node) => node.append('\n'));
  return document.body.textContent || '';
}
interface Props {
  visible: boolean;
  event: CalendarEvent | null;
  onClose: () => void;
  onOpenMeeting: (id: string) => void;
  onStartMeeting?: (event: CalendarEvent) => Promise<void>;
  recordingBusy?: boolean;
}
export const PreMeetingBriefSheet = ({
  visible,
  event,
  onClose,
  onOpenMeeting,
  onStartMeeting,
  recordingBusy = false,
}: Props) => {
  const [prep, setPrep] = useState<MeetingPrep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const editor = useRef<MeetingPrepEditorHandle>(null);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setPrep(null);
    setError(null);
    setStarting(false);
    if (!visible || !event) return;
    setLoading(true);
    void openMeetingPrep(event)
      .then((value) => {
        if (current === generation.current) setPrep(value);
      })
      .catch(() => {
        if (current === generation.current)
          setError(
            'Preparation could not be opened. Try reopening this meeting.',
          );
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [visible, event]);
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);
  const close = async () => {
    try {
      await editor.current?.flush();
      onClose();
      return true;
    } catch {
      setError(
        'Your preparation could not be saved. Retry save before closing.',
      );
      return false;
    }
  };
  if (!visible) return null;
  const calendar = prep?.event || event;
  const blocker = calendar ? prepStartBlocker(calendar, now) : null;
  const roster = calendar
    ? [
        ...calendar.attendees,
        ...(calendar.organizer ? [calendar.organizer] : []),
      ].filter(
        (person, index, list) =>
          list.findIndex(
            (p) => (p.email || p.name) === (person.email || person.name),
          ) === index,
      )
    : [];
  return (
    <section
      aria-labelledby="pre-meeting-brief-title"
      className="no-drag relative mx-auto flex w-full max-w-3xl flex-col"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-3 sm:px-6">
        <button
          type="button"
          aria-label="Back from meeting prep"
          onClick={() => void close()}
          className="no-drag inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-pro-text-muted hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </button>
        <button
          type="button"
          title={
            !prep?.meetingId
              ? recordingBusy
                ? 'Finish the active recording before starting another.'
                : blocker || undefined
              : undefined
          }
          disabled={
            !prep ||
            starting ||
            (!prep.meetingId && (!!blocker || recordingBusy || !onStartMeeting))
          }
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-pro-accent px-4 py-2 text-sm font-medium text-white hover:bg-pro-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-40"
          onClick={async () => {
            if (!prep || !calendar) return;
            setStarting(true);
            setError(null);
            try {
              await editor.current?.flush();
              if (prep.meetingId) {
                onClose();
                onOpenMeeting(prep.meetingId);
              } else {
                await onStartMeeting?.(calendar);
                onClose();
              }
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Meeting could not start. Your preparation is retained.',
              );
            } finally {
              setStarting(false);
            }
          }}
        >
          {starting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} />
          )}{' '}
          {prep?.meetingId ? 'Open meeting' : 'Start meeting'}
        </button>
      </div>
      <header className="border-b border-pro-border/70 px-2 pb-7 pt-8 sm:px-6">
        <div className="min-w-0">
          <h2
            id="pre-meeting-brief-title"
            title={calendar?.title}
            className="break-words font-serif text-[34px] font-medium leading-[1.18] tracking-[-0.02em] text-pro-text-main sm:text-[38px]"
          >
            {calendar?.title || 'Prepare a meeting'}
          </h2>
          {calendar && (
            <p className="mt-3 text-[13px] leading-5 text-pro-text-muted">
              {formatPrepDate(calendar.start)} ·{' '}
              {new Date(calendar.start).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}{' '}
              –{' '}
              {new Date(calendar.end).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
      </header>
      <div className="min-h-0 space-y-8 px-2 py-7 sm:px-6">
        {error && (
          <p role="alert" className="mb-4 text-sm text-pro-text-muted">
            {error}
          </p>
        )}
        {loading && (
          <div className="border-y border-pro-border/70 py-6">
            <MeetingPrepBriefSkeleton />
          </div>
        )}
        {!event && (
          <p className="text-sm text-pro-text-muted">
            Choose a calendar meeting to prepare its notes and references.
          </p>
        )}
        {!!roster.length && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h3 className="text-[13px] font-medium text-pro-text-muted">
              Invited people
            </h3>
            <div className="flex flex-wrap gap-2">
              {roster.map((person, index) => (
                <span
                  key={person.email || `${person.name}-${index}`}
                  title={[person.name, person.email]
                    .filter(Boolean)
                    .join(' · ')}
                  className="max-w-full truncate rounded-full border border-pro-border/70 bg-pro-surface/40 px-2.5 py-1 text-xs text-pro-text-main"
                >
                  {person.isCurrentUser
                    ? 'You'
                    : person.name || person.email || 'Unknown attendee'}
                </span>
              ))}
            </div>
          </div>
        )}
        {calendar && (
          <section aria-label="Calendar agenda" className="max-w-[68ch]">
            <h3 className="text-sm font-medium text-pro-text-main">
              Calendar agenda
            </h3>
            {calendar.agenda || calendar.notes ? (
              <div className="mt-3 max-w-[68ch] whitespace-pre-wrap break-words text-sm leading-6 text-pro-text-main">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-pro-accent underline underline-offset-2"
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {agendaMarkdown(calendar.agenda || calendar.notes || '')}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="mt-2 text-sm text-pro-text-muted">
                No calendar agenda was available to Pluto for this event.
              </p>
            )}
          </section>
        )}
        {prep && (
          <MeetingPrepEditor
            key={prep.occurrenceKey}
            ref={editor}
            prep={prep}
            onChange={setPrep}
            onOpenMeeting={(id) => {
              void close().then((saved) => {
                if (saved) onOpenMeeting(id);
              });
            }}
          />
        )}
      </div>
    </section>
  );
};
