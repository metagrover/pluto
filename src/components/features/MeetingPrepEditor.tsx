import { ChevronDown, Plus, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type {
  MeetingPrep,
  PrepMeetingOption,
} from '../../../electron/meetingPrep';
import {
  getMeetingPrep,
  listPrepMeetings,
  saveMeetingPrep,
} from '../../api/meetingPrep';
import {
  formatPrepDate,
  formatPrepParticipants,
} from '../../utils/meetingPrepPresentation';
import { MeetingPrepBrief } from './MeetingPrepBrief';
export interface MeetingPrepEditorHandle {
  flush: () => Promise<void>;
}
export const MeetingPrepEditor = forwardRef<
  MeetingPrepEditorHandle,
  {
    prep: MeetingPrep;
    onOpenMeeting?: (id: string) => void;
    onChange?: (prep: MeetingPrep) => void;
  }
>(({ prep, onOpenMeeting, onChange }, ref) => {
  const draftKey = `pluto.prep-draft:${prep.occurrenceKey}`;
  const [record, setRecord] = useState(prep);
  const recordRef = useRef(prep);
  const [notes, setNotes] = useState(
    () => localStorage.getItem(draftKey) ?? prep.notes,
  );
  const notesRef = useRef(notes);
  const [status, setStatus] = useState('Saved');
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [regeneration, setRegeneration] = useState(0);
  const [meetings, setMeetings] = useState<PrepMeetingOption[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!picker) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      setPicker(false);
      setSelectedIds(
        (recordRef.current.meetings || []).map((meeting) => meeting.id),
      );
      pickerTrigger.current?.focus();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [picker, busy]);
  const mounted = useRef(true);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const adopt = (next: MeetingPrep) => {
    recordRef.current = next;
    if (mounted.current) {
      setRecord(next);
      onChange?.(next);
    }
  };
  const enqueue = (patch: Parameters<typeof saveMeetingPrep>[1]) => {
    const work = queue.current.then(async () => {
      if (mounted.current) {
        setStatus('Saving…');
        setError(null);
      }
      const next = await saveMeetingPrep(recordRef.current, patch);
      adopt(next);
      if (mounted.current) setError(null);
      if (notesRef.current === next.notes) localStorage.removeItem(draftKey);
      if (mounted.current)
        setStatus(
          notesRef.current === next.notes ? 'Saved' : 'Unsaved changes',
        );
    });
    queue.current = work.catch((cause) => {
      if (mounted.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not save preparation. Your draft is retained on this device.',
        );
        setStatus('Not saved');
      }
    });
    return work;
  };
  const flush = async () => {
    await queue.current;
    if (notesRef.current !== recordRef.current.notes)
      await enqueue({ notes: notesRef.current });
    if (error && notesRef.current === recordRef.current.notes)
      throw new Error(error);
  };
  useImperativeHandle(ref, () => ({ flush }));
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (notesRef.current !== recordRef.current.notes)
        void enqueue({ notes: notesRef.current }).catch(() => {});
    }, 450);
    return () => clearTimeout(timer);
  }, [notes]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (notesRef.current !== recordRef.current.notes)
        void enqueue({ notes: notesRef.current }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    const off = window.ipcRenderer.on(
      'meeting-prep:updated',
      (_event, next: MeetingPrep) => {
        if (
          next.occurrenceKey !== recordRef.current.occurrenceKey ||
          next.revision <= recordRef.current.revision
        )
          return;
        const clean = notesRef.current === recordRef.current.notes;
        const ownText = notesRef.current === next.notes;
        adopt(next);
        if (clean) {
          notesRef.current = next.notes;
          setNotes(next.notes);
        } else if (ownText) {
          setError(null);
          setStatus('Saved');
        } else {
          setError(
            'Preparation changed in another view. Your draft is retained; retry to save your text.',
          );
        }
      },
    );
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);
  useEffect(() => {
    if (!picker) return;
    let current = true;
    setLoadingMeetings(true);
    const timer = window.setTimeout(() => {
      void listPrepMeetings(query, prep.occurrenceKey)
        .then((result) => {
          if (current) setMeetings(result);
        })
        .catch(() => {
          if (current)
            setError(
              'Past meetings could not be loaded. Close the picker and try again.',
            );
        })
        .finally(() => {
          if (current) setLoadingMeetings(false);
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [picker, query, prep.occurrenceKey]);
  const mutateMeeting = async (
    patch: Parameters<typeof saveMeetingPrep>[1],
  ) => {
    setBusy(true);
    try {
      await flush();
      await enqueue(patch);
    } catch {
      /* Saved draft/error remains visible. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5" data-meeting-prep-document>
      <MeetingPrepBrief
        prep={record}
        onOpenMeeting={onOpenMeeting}
        regeneration={regeneration}
        onRegenerate={() => setRegeneration((value) => value + 1)}
        disabled={busy}
      />
      {error && (
        <div role="alert" className="text-xs text-pro-text-muted">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 text-pro-accent"
            onClick={async () => {
              try {
                const latest = await getMeetingPrep(prep.occurrenceKey);
                if (latest) adopt(latest);
                await enqueue({ notes: notesRef.current });
              } catch {
                /* Error shown by save. */
              }
            }}
          >
            Retry save
          </button>
        </div>
      )}
      <details
        open
        className="group/notes rounded-lg border border-pro-border p-4"
      >
        <summary className="flex min-h-6 cursor-pointer list-none items-center justify-between gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent text-sm font-medium text-pro-text-main [&::-webkit-details-marker]:hidden">
          <span>
            Add your notes{' '}
            <span className="ml-2 text-xs font-normal text-pro-text-muted">
              {notes.trim() ? status : ''}
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="shrink-0 text-pro-text-muted motion-reduce:transition-none transition-transform group-open/notes:rotate-180"
          />
        </summary>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`prep-notes-${prep.occurrenceKey}`}
              className="text-sm font-medium text-pro-text-main"
            >
              Preparation, questions & agenda
            </label>
            <span role="status" className="text-[10px] text-pro-text-muted">
              {status}
            </span>
          </div>
          <textarea
            id={`prep-notes-${prep.occurrenceKey}`}
            aria-label="Preparation notes"
            value={notes}
            maxLength={100000}
            onChange={(e) => {
              notesRef.current = e.target.value;
              setNotes(e.target.value);
              setStatus('Unsaved changes');
              try {
                localStorage.setItem(draftKey, e.target.value);
              } catch {
                setError(
                  'Device draft storage is unavailable. Keep this view open until saved.',
                );
              }
            }}
            placeholder="What do you want to discuss? Add your notes, questions, and agenda…"
            className="min-h-[240px] w-full resize-y rounded-lg border border-pro-border bg-pro-surface/25 p-4 text-sm leading-6 text-pro-text-main placeholder:text-pro-text-muted/60 focus:outline-none focus:ring-2 focus:ring-pro-accent"
          />
        </div>
      </details>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-pro-text-muted">
            Included meetings
          </h3>
          <button
            type="button"
            disabled={busy}
            className="inline-flex min-h-8 items-center gap-1 rounded px-2 py-1 text-xs text-pro-accent hover:bg-pro-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-40"
            ref={pickerTrigger}
            onClick={() => {
              setSelectedIds((record.meetings || []).map((m) => m.id));
              setPicker(!picker);
            }}
          >
            <Plus size={14} />
            Add past meetings
          </button>
        </div>
        {picker && (
          <div className="rounded-lg border border-pro-border p-3">
            <input
              aria-label="Search past meetings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search meeting titles or notes"
              className="w-full rounded border border-pro-border bg-pro-bg p-2 text-xs text-pro-text-main"
            />
            <div className="mt-2 max-h-48 overflow-y-auto">
              {meetings.map((m) => (
                <label
                  key={m.id}
                  className="flex w-full cursor-pointer items-start gap-3 rounded px-2 py-2 text-left text-xs text-pro-text-main hover:bg-pro-surface"
                >
                  <input
                    type="checkbox"
                    aria-label={`Include ${m.title}`}
                    checked={selectedIds.includes(m.id)}
                    disabled={busy}
                    onChange={(event) =>
                      setSelectedIds((ids) =>
                        event.target.checked
                          ? [...ids, m.id]
                          : ids.filter((id) => id !== m.id),
                      )
                    }
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{m.title}</span>
                    <span className="mt-1 block text-pro-text-muted">
                      {m.date && formatPrepDate(m.date)}
                      {m.participants
                        ? ` · ${formatPrepParticipants(m.participants)}`
                        : ''}
                    </span>
                    {m.preview && (
                      <span className="mt-1 line-clamp-2 block text-pro-text-muted">
                        {m.preview}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              {loadingMeetings && (
                <p role="status" className="py-2 text-xs text-pro-text-muted">
                  Loading meetings…
                </p>
              )}
              {!loadingMeetings && !meetings.length && (
                <p className="py-2 text-xs text-pro-text-muted">
                  {query
                    ? 'No matching past meetings.'
                    : 'No past meetings available.'}
                </p>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-pro-text-muted">
                {selectedIds.length} selected
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPicker(false)}
                  className="px-3 py-2 text-xs text-pro-text-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || selectedIds.length > 20}
                  className="rounded bg-pro-accent px-3 py-2 text-xs text-white disabled:opacity-40"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await flush();
                      await enqueue({ meetingIds: selectedIds });
                      setPicker(false);
                    } catch {
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save meetings
                </button>
              </div>
            </div>
          </div>
        )}
        {!picker &&
          (record.meetings || []).map((meeting) => (
            <article
              key={meeting.id}
              className="rounded-lg border border-pro-border transition-colors hover:bg-pro-surface/30"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Open meeting: ${meeting.title}`}
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await flush();
                      onOpenMeeting?.(meeting.id);
                    } catch {
                      /* Save error remains visible. */
                    }
                  }}
                  className="min-w-0 flex-1 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                >
                  <span
                    title={meeting.title}
                    className="block truncate text-sm text-pro-text-main"
                  >
                    {meeting.title}
                  </span>
                  <span className="mt-1 block text-xs text-pro-text-muted">
                    {meeting.date && formatPrepDate(meeting.date)}
                    {meeting.participants
                      ? ` · ${formatPrepParticipants(meeting.participants)}`
                      : ''}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${meeting.title} from prep`}
                  onClick={() =>
                    void mutateMeeting({ removeMeetingId: meeting.id })
                  }
                  className="mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-pro-text-muted hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-40"
                >
                  <X size={14} />
                </button>
              </div>
            </article>
          ))}
      </section>
    </div>
  );
});

export function SavedMeetingPrep({
  meetingId,
  event,
  onOpenMeeting,
}: {
  meetingId?: string;
  event?: import('../../../electron/calendar/types').CalendarEvent | null;
  onOpenMeeting?: (id: string) => void;
}) {
  const [prep, setPrep] = useState<MeetingPrep | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    setPrep(null);
    setError(false);
    const request = meetingId
      ? import('../../api/meetingPrep').then((api) =>
          api.getPrepForMeeting(meetingId),
        )
      : event
        ? import('../../api/meetingPrep').then((api) =>
            api.getMeetingPrep(event.occurrenceKey),
          )
        : Promise.resolve(null);
    void request
      .then((value) => {
        if (current) setPrep(value);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [meetingId, event?.occurrenceKey]);
  return prep ? (
    <MeetingPrepEditor
      key={prep.occurrenceKey}
      prep={prep}
      onOpenMeeting={onOpenMeeting}
    />
  ) : (
    <p className="p-4 text-xs text-pro-text-muted">
      {error
        ? 'Preparation could not be loaded. Reopen this tab to retry.'
        : 'No saved preparation for this meeting.'}
    </p>
  );
}
