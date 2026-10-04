import { BookOpenText, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type {
  CalendarDescriptor,
  CalendarEvent,
  CalendarIntegrationSnapshot,
} from '../../../electron/calendar/types';

interface UpcomingMeetingsProps {
  snapshot: CalendarIntegrationSnapshot | null;
  events: CalendarEvent[];
  loading: boolean;
  connectError?: string | null;
  onConnect: () => Promise<void>;
  onOpenPrivacy?: () => void;
  onSelectCalendar?: (calendar: CalendarDescriptor) => Promise<void>;
  onSelectCalendars?: (calendars: CalendarDescriptor[]) => Promise<void>;
  onRefreshCalendar: () => Promise<void>;
  onOpenSettings: () => void;
  onPrepare: (event: CalendarEvent) => void;
}

const LARGE_DASHBOARD_QUERY = '(min-width: 1024px)';

const matchesLargeDashboard = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(LARGE_DASHBOARD_QUERY).matches
    : false;

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
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ${remainingMinutes} mins`;
};

const isSameLocalDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const formatEventDay = (value: string, today: Date) => {
  const eventDate = new Date(value);
  if (isSameLocalDay(eventDate, today)) return null;
  const tomorrow = new Date(today);
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameLocalDay(eventDate, tomorrow)) return 'Tomorrow';
  return eventDate.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
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
  connectError = null,
  onConnect,
  onOpenPrivacy = () => {},
  onSelectCalendar,
  onSelectCalendars,
  onRefreshCalendar,
  onOpenSettings,
  onPrepare,
}: UpcomingMeetingsProps) => {
  const [expanded, setExpanded] = useState(false);
  const [usesLargeLayout, setUsesLargeLayout] = useState(matchesLargeDashboard);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (snapshot?.selectedCalendars?.length) {
      for (const cal of snapshot.selectedCalendars) {
        initial.add(cal.identifier);
      }
    } else if (snapshot?.selectedCalendar) {
      initial.add(snapshot.selectedCalendar.identifier);
    }
    return initial;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const collapsedLimit = usesLargeLayout ? 5 : 3;
  const visibleEvents = expanded ? events : events.slice(0, collapsedLimit);
  const hiddenCount = Math.max(0, events.length - collapsedLimit);
  const today = new Date();
  const hasMeetingsToday = events.some((event) =>
    isSameLocalDay(new Date(event.start), today),
  );
  const selectedList =
    snapshot?.selectedCalendars && snapshot.selectedCalendars.length > 0
      ? snapshot.selectedCalendars
      : snapshot?.selectedCalendar
        ? [snapshot.selectedCalendar]
        : [];
  const hasConnectedCalendar =
    selectedList.length > 0 &&
    (snapshot?.state === 'ready' || events.length > 0);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const query = window.matchMedia(LARGE_DASHBOARD_QUERY);
    const updateLayout = (event: MediaQueryListEvent) =>
      setUsesLargeLayout(event.matches);
    setUsesLargeLayout(query.matches);
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', updateLayout);
      return () => query.removeEventListener('change', updateLayout);
    }
    if (typeof query.addListener === 'function') {
      query.addListener(updateLayout);
      return () => query.removeListener(updateLayout);
    }
  }, []);

  useEffect(() => {
    if (snapshot?.selectedCalendars?.length) {
      setCheckedIds(
        new Set(snapshot.selectedCalendars.map((cal) => cal.identifier)),
      );
    } else if (snapshot?.selectedCalendar) {
      setCheckedIds(new Set([snapshot.selectedCalendar.identifier]));
    }
  }, [snapshot?.selectedCalendars, snapshot?.selectedCalendar]);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleOutsideClick = (event: PointerEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen]);

  const handleToggleAndCommit = async (id: string) => {
    const next = new Set(checkedIds);
    if (next.has(id)) {
      if (next.size <= 1) return;
      next.delete(id);
    } else {
      next.add(id);
    }
    setCheckedIds(next);
    setIsSubmitting(true);
    setSelectionError(null);
    try {
      const chosen = (snapshot?.calendars ?? []).filter((cal) =>
        next.has(cal.identifier),
      );
      if (onSelectCalendars) {
        await onSelectCalendars(chosen);
      } else if (onSelectCalendar && chosen.length > 0) {
        await onSelectCalendar(chosen[0]);
      }
    } catch {
      setCheckedIds(checkedIds);
      setSelectionError('Calendar couldn’t be selected. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const triggerLabel =
    snapshot?.state === 'selected_calendar_missing'
      ? 'Choose another calendar'
      : checkedIds.size > 0
        ? `${checkedIds.size} calendar${checkedIds.size === 1 ? '' : 's'} selected`
        : 'Choose calendars';

  return (
    <section
      aria-labelledby="upcoming-meetings-title"
      aria-busy={loading}
      className="min-w-0"
    >
      <div>
        <p className="text-[11px] font-normal tracking-[0.02em] text-pro-text-muted">
          Your day
        </p>
        <h2
          id="upcoming-meetings-title"
          className="mt-1.5 whitespace-nowrap text-[18px] font-serif font-medium leading-tight text-pro-text-main"
        >
          Upcoming meetings
        </h2>
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
            {connectError && (
              <div
                role="alert"
                className="mt-2 text-[11px] leading-5 text-rose-700"
              >
                <p>{connectError}</p>
                <button
                  type="button"
                  onClick={onOpenPrivacy}
                  className="mt-1 font-semibold underline"
                >
                  Open Calendar settings
                </button>
              </div>
            )}
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
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              aria-label={triggerLabel}
              aria-haspopup="true"
              aria-expanded={isDropdownOpen}
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              className="flex min-h-9 w-full items-center justify-between rounded-md border border-pro-border/70 bg-pro-surface/50 px-3 py-1.5 text-left text-[12px] font-medium text-pro-text-main transition-colors hover:border-pro-border hover:bg-pro-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
            >
              <span className="truncate">{triggerLabel}</span>
              {isSubmitting ? (
                <Loader2
                  className="h-3.5 w-3.5 shrink-0 animate-spin text-pro-text-muted"
                  aria-hidden="true"
                />
              ) : isDropdownOpen ? (
                <ChevronUp
                  className="h-3.5 w-3.5 shrink-0 text-pro-text-muted"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="h-3.5 w-3.5 shrink-0 text-pro-text-muted"
                  aria-hidden="true"
                />
              )}
            </button>
            {isDropdownOpen ? (
              <div
                role="menu"
                aria-label="Available calendars"
                className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-60 overflow-y-auto divide-y divide-pro-border/40 rounded-lg border border-pro-border/70 bg-pro-bg shadow-lg"
              >
                {snapshot.calendars.map((calendar) => {
                  const isChecked = checkedIds.has(calendar.identifier);
                  return (
                    <label
                      key={calendar.identifier}
                      className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-pro-surface"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isSubmitting}
                        onChange={() =>
                          void handleToggleAndCommit(calendar.identifier)
                        }
                        className="h-3.5 w-3.5 rounded border-pro-border/70 text-pro-accent focus:ring-pro-accent"
                        aria-label={`${calendar.title} from ${calendar.sourceTitle}`}
                      />
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
                    </label>
                  );
                })}
                {selectionError ? (
                  <p
                    role="alert"
                    className="p-2 text-[10px] font-semibold text-pro-urgent"
                  >
                    {selectionError}
                  </p>
                ) : null}
              </div>
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
            {!hasMeetingsToday ? (
              <p className="mb-4 text-[12px] font-medium text-pro-text-muted">
                No meetings today
              </p>
            ) : null}
            <div className="space-y-3">
              {visibleEvents.map((event, index) => {
                const eventDay = formatEventDay(event.start, today);
                return (
                  <article
                    key={event.occurrenceKey}
                    data-testid="upcoming-meeting-row"
                    className="grid grid-cols-[70px_minmax(0,1fr)] gap-3"
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
                      <span className="min-w-0">
                        {eventDay ? (
                          <time
                            dateTime={event.start}
                            data-testid="upcoming-meeting-date"
                            className="block truncate text-[10px] font-normal text-pro-text-muted"
                          >
                            {eventDay}
                          </time>
                        ) : null}
                        <time
                          dateTime={event.start}
                          className="block text-[11px] font-normal tabular-nums text-pro-text-muted"
                        >
                          {formatTime(event.start)}
                        </time>
                      </span>
                    </div>
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3
                          title={event.title || 'Untitled event'}
                          className="truncate text-[13px] font-normal leading-5 text-pro-text-main"
                        >
                          <button
                            type="button"
                            onClick={() => onPrepare(event)}
                            className="block w-full truncate text-left hover:text-pro-accent"
                          >
                            {event.title || 'Untitled event'}
                          </button>
                        </h3>
                        <p className="text-[11px] font-normal leading-4 text-pro-text-muted">
                          {formatDuration(event)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Prepare for ${event.title || 'upcoming meeting'}`}
                        onClick={() => onPrepare(event)}
                        className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                      >
                        <BookOpenText
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        Prep
                      </button>
                    </div>
                  </article>
                );
              })}
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
                {expanded ? 'Show less' : 'More'}
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
            title={`Couldn’t refresh ${selectedList.length === 1 ? selectedList[0].title : 'calendars'}`}
            detail="The calendar is still selected. Pluto can try the local read again."
            action={() => void onRefreshCalendar()}
            actionLabel="Try again"
          />
        ) : (
          <p className="pb-5 text-[12px] font-medium text-pro-text-muted">
            No meetings today
          </p>
        )}
      </div>
      {hasConnectedCalendar ? (
        <div
          data-testid="upcoming-meetings-source"
          className="mt-4 flex min-w-0 items-center gap-2 text-[10px] font-normal text-pro-text-muted"
        >
          <span
            title={
              selectedList.length > 1
                ? selectedList
                    .map((c) => `${c.title} (${c.sourceTitle})`)
                    .join(', ')
                : `${selectedList[0].title} · ${selectedList[0].sourceTitle}`
            }
            className="min-w-0 flex-1 truncate"
          >
            {selectedList.length > 1
              ? `${selectedList.length} calendars`
              : `${selectedList[0].title} · ${selectedList[0].sourceTitle}`}
          </span>
          <button
            type="button"
            aria-label="Change calendar"
            onClick={onOpenSettings}
            className="shrink-0 rounded-sm px-1 py-1 font-medium text-pro-text-muted transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
          >
            Change
          </button>
        </div>
      ) : null}
    </section>
  );
};
