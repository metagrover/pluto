import { Sparkles, X } from 'lucide-react';
import type { CalendarEvent } from '../../../electron/calendar/types';

export interface RecordingCalendarSuggestionProps {
  events: CalendarEvent[];
  selectedOccurrenceKey: string;
  busy: boolean;
  error: string | null;
  onSelect: (occurrenceKey: string) => void;
  onAdd: () => void;
  onDismiss: () => void;
}

const optionLabel = (event: CalendarEvent) => {
  const time = new Date(event.start).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${event.title || 'Untitled meeting'} · ${time}`;
};

export const RecordingCalendarSuggestion = ({
  events,
  selectedOccurrenceKey,
  busy,
  error,
  onSelect,
  onAdd,
  onDismiss,
}: RecordingCalendarSuggestionProps) => (
  <section
    aria-label="Suggested calendar meeting"
    className="mx-4 mt-3 flex shrink-0 flex-wrap items-center gap-2 rounded-full border border-pro-accent/25 bg-pro-accent/10 px-3 py-2 text-pro-text-main sm:mx-6 sm:gap-3 sm:px-4"
  >
    <Sparkles
      aria-hidden="true"
      size={16}
      className="shrink-0 text-pro-accent"
    />
    <span className="shrink-0 text-sm font-medium text-pro-accent">
      Suggested meeting:
    </span>
    <label className="min-w-0 flex-1 sm:max-w-[340px]">
      <span className="sr-only">Overlapping calendar invite</span>
      <select
        aria-label="Overlapping calendar invite"
        value={selectedOccurrenceKey}
        onChange={(event) => onSelect(event.target.value)}
        disabled={busy}
        className="h-9 w-full min-w-0 rounded-full border border-pro-border bg-pro-surface px-3 text-sm text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
      >
        {events.length > 1 && <option value="">Choose a meeting</option>}
        {events.map((event) => (
          <option key={event.occurrenceKey} value={event.occurrenceKey}>
            {optionLabel(event)}
          </option>
        ))}
      </select>
    </label>
    <button
      type="button"
      onClick={onAdd}
      disabled={!selectedOccurrenceKey || busy}
      aria-label="Add selected calendar invite to this recording"
      className="h-9 shrink-0 rounded-full bg-pro-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-pro-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? 'Adding…' : 'Add'}
    </button>
    <button
      type="button"
      onClick={onDismiss}
      disabled={busy}
      aria-label="Dismiss suggested meeting"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-40"
    >
      <X aria-hidden="true" size={17} />
    </button>
    {error && (
      <p role="alert" className="w-full px-2 text-xs text-pro-warning">
        {error}
      </p>
    )}
  </section>
);
