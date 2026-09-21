import { ArrowUpRight, Loader2, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../../../electron/calendar/types';
import type {
  PreMeetingBrief,
  PreMeetingBriefItem,
} from '../../../electron/preMeetingBrief';
import { buildPreMeetingBrief } from '../../api/calendar';

interface PreMeetingBriefSheetProps {
  visible: boolean;
  event: CalendarEvent | null;
  onClose: () => void;
  onOpenMeeting: (meetingId: string) => void;
}

const formatDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : null;

const trustLabel = (status: PreMeetingBriefItem['trustStatus']) => {
  if (status === 'needs_review') return 'Review';
  if (status === 'inferred') return 'Related';
  if (status === 'stale') return 'Older context';
  return 'Source-backed';
};

const BriefSection = ({
  title,
  items,
  onOpenMeeting,
}: {
  title: string;
  items: PreMeetingBriefItem[];
  onOpenMeeting: (meetingId: string) => void;
}) => {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-pro-text-muted/70">
        {title}
      </h3>
      <div className="mt-3 space-y-3">
        {items.map((entry) => (
          <article key={entry.id} className="border-l border-pro-border pl-3">
            <p className="text-[13px] leading-5 text-pro-text-main">
              {entry.text}
            </p>
            <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[9px] font-medium text-pro-text-muted/65">
              <span>{trustLabel(entry.trustStatus)}</span>
              <span aria-hidden="true">·</span>
              {entry.sourceMeetingId ? (
                <button
                  type="button"
                  onClick={() => onOpenMeeting(entry.sourceMeetingId!)}
                  className="inline-flex min-w-0 items-center gap-1 truncate hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                >
                  <span className="truncate">{entry.sourceLabel}</span>
                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                </button>
              ) : (
                <span className="truncate">{entry.sourceLabel}</span>
              )}
              {entry.sourceDate ? (
                <span className="shrink-0">{formatDate(entry.sourceDate)}</span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

const BriefBody = ({
  brief,
  onOpenMeeting,
  onPrepareAnother,
}: {
  brief: PreMeetingBrief;
  onOpenMeeting: (meetingId: string) => void;
  onPrepareAnother: () => void;
}) => {
  const relationshipLabel =
    brief.relationship === 'same_series'
      ? 'Same recurring series'
      : brief.relationship === 'related'
        ? 'Related previous meeting'
        : brief.relationship === 'manual'
          ? 'Closest matching meeting'
          : null;
  return (
    <div className="space-y-7">
      {relationshipLabel ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-pro-surface/60 px-3 py-2 text-[10px] font-medium text-pro-text-muted">
          <span>{relationshipLabel}</span>
          {brief.priorMeeting ? (
            <span className="shrink-0">
              {formatDate(brief.priorMeeting.startedAt)}
            </span>
          ) : null}
        </div>
      ) : null}
      {brief.agenda ? (
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-pro-text-muted/70">
            Agenda
          </h3>
          <p className="mt-3 whitespace-pre-line text-[13px] leading-5 text-pro-text-main">
            {brief.agenda}
          </p>
        </section>
      ) : null}
      <BriefSection
        title="Last time"
        items={brief.lastTime}
        onOpenMeeting={onOpenMeeting}
      />
      <BriefSection
        title="Still open"
        items={brief.stillOpen}
        onOpenMeeting={onOpenMeeting}
      />
      <BriefSection
        title="Relevant context"
        items={brief.relevantContext}
        onOpenMeeting={onOpenMeeting}
      />
      {brief.emptyMessage ? (
        <p className="rounded-lg border border-pro-border/70 bg-pro-surface/35 p-4 text-[12px] leading-5 text-pro-text-muted">
          {brief.emptyMessage}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onPrepareAnother}
        className="text-[10px] font-semibold text-pro-text-muted hover:text-pro-text-main"
      >
        Prepare another conversation
      </button>
    </div>
  );
};

export const PreMeetingBriefSheet = ({
  visible,
  event,
  onClose,
  onOpenMeeting,
}: PreMeetingBriefSheetProps) => {
  const [brief, setBrief] = useState<PreMeetingBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const requestIdRef = useRef(0);

  const load = async (
    next:
      | { kind: 'calendar'; event: CalendarEvent }
      | { kind: 'query'; query: string },
  ) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await buildPreMeetingBrief(next);
      if (requestId === requestIdRef.current) setBrief(result);
    } catch {
      if (requestId === requestIdRef.current) {
        setError(
          'This brief couldn’t be prepared. Recording is still available.',
        );
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) {
      requestIdRef.current += 1;
      return;
    }
    setBrief(null);
    setError(null);
    setManualMode(false);
    if (event) void load({ kind: 'calendar', event });
  }, [event, visible]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/20 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="pre-meeting-brief-title"
        className="flex h-full w-full max-w-[520px] flex-col border-l border-pro-border bg-pro-bg shadow-2xl"
      >
        <header className="flex items-start justify-between gap-6 border-b border-pro-border/70 px-7 py-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-pro-accent">
              30-second prep
            </p>
            <h2
              id="pre-meeting-brief-title"
              className="mt-2 truncate font-serif text-[24px] font-medium text-pro-text-main"
            >
              {brief?.title ||
                (!manualMode ? event?.title : null) ||
                'Prepare a conversation'}
            </h2>
            {brief?.startsAt ? (
              <p className="mt-1 text-[11px] font-medium text-pro-text-muted">
                {new Date(brief.startsAt).toLocaleString([], {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close brief"
            onClick={onClose}
            className="rounded-md p-2 text-pro-text-muted hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-pro-urgent/25 bg-pro-urgent/5 p-4 text-[12px] leading-5 text-pro-text-main"
            >
              {error}
            </p>
          ) : brief ? (
            <BriefBody
              brief={brief}
              onOpenMeeting={onOpenMeeting}
              onPrepareAnother={() => {
                setBrief(null);
                setQuery('');
                setManualMode(true);
              }}
            />
          ) : manualMode || !event ? (
            <form
              onSubmit={(formEvent) => {
                formEvent.preventDefault();
                if (query.trim()) void load({ kind: 'query', query });
              }}
              className="rounded-lg border border-pro-border/70 bg-pro-surface/45 p-4"
            >
              <label
                htmlFor="brief-query"
                className="text-[12px] font-medium text-pro-text-main"
              >
                Who or what are you meeting about?
              </label>
              <p className="mt-1 text-[10px] leading-4 text-pro-text-muted">
                Enter a person, project, stream, or conversation topic.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  id="brief-query"
                  value={query}
                  onChange={(inputEvent) => setQuery(inputEvent.target.value)}
                  placeholder="e.g. Launch planning"
                  className="min-w-0 flex-1 rounded-md border border-pro-border bg-pro-bg px-3 py-2 text-[12px] text-pro-text-main placeholder:text-pro-text-muted/55 focus:outline-none focus:ring-2 focus:ring-pro-accent"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || loading}
                  className="inline-flex items-center gap-1.5 rounded-md bg-pro-accent px-3 text-[11px] font-semibold text-white transition-opacity disabled:opacity-45"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                  Prepare
                </button>
              </div>
            </form>
          ) : loading ? (
            <div
              className="flex min-h-52 items-center justify-center text-pro-text-muted"
              aria-label="Preparing brief"
            >
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
};
