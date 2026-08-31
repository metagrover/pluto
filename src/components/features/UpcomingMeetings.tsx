import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

import type {
  CalendarDescriptor,
  CalendarEvent,
  CalendarIntegrationSnapshot,
} from '../../../electron/calendar/types';

interface UpcomingMeetingsProps {
  snapshot: CalendarIntegrationSnapshot | null;
  events: CalendarEvent[];
  loading: boolean;
  onConnect: () => Promise<void>;
  onSelectCalendar: (calendar: CalendarDescriptor) => Promise<void>;
  onRefreshCalendar: () => Promise<void>;
  onOpenSettings: () => void;
}

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

const formatDuration = (event: CalendarEvent) => {
  const minutes = Math.max(
    1,
    Math.round(
      (new Date(event.end).getTime() - new Date(event.start).getTime()) /
        60_000,
    ),
  );
  if (minutes === 60) return '1 hour';
  if (minutes > 60 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
};

const RecoveryAction = ({
  title,
  detail,
  action,
  actionLabel,
}: {
  title: string;
  detail: string;
  action: () => void;
  actionLabel: string;
}) => (
  <div className="pb-5">
    <p className="text-[13px] font-medium leading-5 text-pro-text-main">
      {title}
    </p>
    <p className="mt-1 text-[11px] font-medium leading-5 text-pro-text-muted">
      {detail}
    </p>
    <button
      type="button"
      aria-label={actionLabel}
      onClick={action}
      className="mt-2 inline-flex min-h-9 items-center text-[11px] font-semibold text-pro-accent transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
    >
      {actionLabel}
    </button>
  </div>
);

export const UpcomingMeetings = ({
  snapshot,
  events,
  loading,
  onConnect,
  onSelectCalendar,
  onRefreshCalendar,
  onOpenSettings,
}: UpcomingMeetingsProps) => {
  const [expanded, setExpanded] = useState(false);
  const [selectingCalendarId, setSelectingCalendarId] = useState<string | null>(
    null,
  );
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const visibleEvents = expanded ? events : events.slice(0, 2);
  const hiddenCount = Math.max(0, events.length - 2);

  const chooseCalendar = async (calendar: CalendarDescriptor) => {
    setSelectingCalendarId(calendar.identifier);
    setSelectionError(null);
    try {
      await onSelectCalendar(calendar);
    } catch {
      setSelectionError('Calendar couldn’t be selected. Try again.');
    } finally {
      setSelectingCalendarId(null);
    }
  };

  return (
    <section
      aria-labelledby="upcoming-meetings-title"
      aria-busy={loading}
      className="min-w-0"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium text-pro-text-muted/60">
            Your day
          </p>
          <h2
            id="upcoming-meetings-title"
            className="mt-1 text-[20px] font-serif font-medium text-pro-text-main"
          >
            Upcoming meetings
          </h2>
        </div>
        {snapshot?.selectedCalendar ? (
          <span
            title={`${snapshot.selectedCalendar.title} · ${snapshot.selectedCalendar.sourceTitle}`}
            className="max-w-24 truncate text-[9px] font-semibold text-pro-text-muted/55"
          >
            {snapshot.selectedCalendar.title}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        {loading || !snapshot ? (
          <div data-testid="upcoming-meetings-loading" className="space-y-3">
            <div className="h-11 rounded-md bg-pro-surface/70" />
            <div className="h-11 rounded-md bg-pro-surface/70" />
          </div>
        ) : snapshot.state === 'not_determined' ? (
          <div className="pb-5">
            <p className="text-[12px] font-medium leading-5 text-pro-text-main">
              See what’s next
            </p>
            <p className="mt-1 text-[11px] font-medium leading-5 text-pro-text-muted">
              Show meetings from one calendar already on this Mac.
            </p>
            <button
              type="button"
              aria-label="Connect Calendar"
              onClick={() => void onConnect()}
              className="mt-2 inline-flex min-h-8 items-center justify-center rounded-md border border-pro-border/60 bg-pro-surface/70 px-3 text-[11px] font-semibold text-pro-text-muted transition-colors hover:border-pro-border hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
            >
              Connect calendar
            </button>
          </div>
        ) : snapshot.state === 'denied' || snapshot.state === 'restricted' ? (
          <RecoveryAction
            title="Calendar access is off"
            detail="Recording still works. Allow Calendar access in System Settings to see your day here."
            action={onOpenSettings}
            actionLabel="Open Calendar settings"
          />
        ) : snapshot.state === 'needs_selection' ||
          snapshot.state === 'selected_calendar_missing' ? (
          <div className="pb-5">
            <p className="text-[13px] font-medium leading-5 text-pro-text-main">
              {snapshot.state === 'selected_calendar_missing'
                ? 'Choose another calendar'
                : 'Choose one calendar'}
            </p>
            <p className="mt-1 text-[11px] font-medium leading-5 text-pro-text-muted">
              Pluto will read meetings from this calendar only.
            </p>
            <div className="mt-3 max-h-48 divide-y divide-pro-border/50 overflow-y-auto rounded-lg border border-pro-border/60 bg-pro-surface/55">
              {snapshot.calendars.map((calendar) => (
                <button
                  key={calendar.identifier}
                  type="button"
                  aria-label={`Use ${calendar.title} calendar from ${calendar.sourceTitle}`}
                  disabled={selectingCalendarId !== null}
                  onClick={() => void chooseCalendar(calendar)}
                  className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-pro-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-55"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-pro-accent"
                    style={
                      calendar.colorHex
                        ? { backgroundColor: calendar.colorHex }
                        : undefined
                    }
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-pro-text-main">
                      {calendar.title}
                    </span>
                    <span className="block truncate text-[9px] font-medium text-pro-text-muted/75">
                      {calendar.sourceTitle}
                    </span>
                  </span>
                  {selectingCalendarId === calendar.identifier ? (
                    <span className="text-[9px] font-semibold text-pro-text-muted">
                      Selecting…
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {selectionError ? (
              <p
                role="alert"
                className="mt-2 text-[10px] font-semibold text-pro-urgent"
              >
                {selectionError}
              </p>
            ) : null}
          </div>
        ) : snapshot.state === 'no_calendars' ? (
          <RecoveryAction
            title="No calendars found"
            detail="Add an account to macOS, then return to Pluto."
            action={onOpenSettings}
            actionLabel="Open Internet Accounts"
          />
        ) : snapshot.state === 'runtime_missing' ||
          snapshot.state === 'unsupported_platform' ? (
          <p className="pb-5 text-[11px] font-medium leading-5 text-pro-text-muted">
            Calendar context isn’t available on this device.
          </p>
        ) : events.length ? (
          <>
            <div className="divide-y divide-pro-border/60">
              {visibleEvents.map((event, index) => (
                <article
                  key={event.occurrenceKey}
                  data-testid="upcoming-meeting-row"
                  className="grid grid-cols-[70px_minmax(0,1fr)] gap-3 py-3 first:pt-0"
                >
                  <div className="flex items-start gap-2 pt-0.5">
                    {index === 0 ? (
                      <span
                        aria-label="Next meeting"
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pro-accent"
                      />
                    ) : (
                      <span className="w-1.5 shrink-0" aria-hidden="true" />
                    )}
                    <time
                      dateTime={event.start}
                      className="text-[10px] font-semibold tabular-nums text-pro-text-muted"
                    >
                      {formatTime(event.start)}
                    </time>
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-[13px] font-medium leading-5 text-pro-text-main">
                      {event.title || 'Untitled event'}
                    </h3>
                    <p className="text-[10px] font-medium leading-4 text-pro-text-muted/70">
                      {formatDuration(event)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
            {hiddenCount > 0 || expanded ? (
              <button
                type="button"
                aria-label={
                  expanded
                    ? 'Show fewer meetings'
                    : `Show ${hiddenCount} more meeting${hiddenCount === 1 ? '' : 's'}`
                }
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
                className="mt-2 inline-flex min-h-9 items-center gap-1 text-[11px] font-semibold text-pro-text-muted transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
              >
                {expanded ? 'Show less' : 'See more'}
                {expanded ? (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            ) : null}
            {snapshot.state === 'read_failed' && snapshot.lastReadAt ? (
              <p className="mt-2 text-[9px] font-medium text-pro-warning">
                Last read{' '}
                {new Date(snapshot.lastReadAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            ) : null}
          </>
        ) : snapshot.state === 'read_failed' ? (
          <RecoveryAction
            title="Calendar couldn’t be read"
            detail="Your calendar is selected. Pluto can try the local read again."
            action={() => void onRefreshCalendar()}
            actionLabel="Try again"
          />
        ) : (
          <p className="pb-5 text-[12px] font-medium text-pro-text-muted">
            No more meetings today
          </p>
        )}
      </div>
    </section>
  );
};
