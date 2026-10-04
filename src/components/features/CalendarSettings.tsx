import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { useState } from 'react';

import type {
  CalendarDescriptor,
  CalendarIntegrationSnapshot,
} from '../../../electron/calendar/types';
import {
  connectCalendar,
  disconnectCalendar,
  openCalendarSystemSettings,
  refreshCalendar,
  selectCalendars,
} from '../../api/calendar';

interface CalendarSettingsProps {
  snapshot: CalendarIntegrationSnapshot | null;
  onSnapshotChange: (snapshot: CalendarIntegrationSnapshot) => void;
}

const SecondaryButton = ({
  children,
  onClick,
  ariaLabel,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}) => (
  <button
    type="button"
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={onClick}
    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-pro-border/70 bg-pro-bg px-3 text-[12px] font-semibold text-pro-text-muted transition-colors hover:border-pro-border hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-50"
  >
    {children}
  </button>
);

export const CalendarSettings = ({
  snapshot,
  onSnapshotChange,
}: CalendarSettingsProps) => {
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedList =
    snapshot?.selectedCalendars && snapshot.selectedCalendars.length > 0
      ? snapshot.selectedCalendars
      : snapshot?.selectedCalendar
        ? [snapshot.selectedCalendar]
        : [];

  const [stagedIds, setStagedIds] = useState<Set<string>>(
    () => new Set(selectedList.map((c) => c.identifier)),
  );

  const [lastSnapshot, setLastSnapshot] = useState(snapshot);
  if (snapshot !== lastSnapshot) {
    setLastSnapshot(snapshot);
    setStagedIds(new Set(selectedList.map((c) => c.identifier)));
  }

  const run = async (
    action: () => Promise<CalendarIntegrationSnapshot>,
    requestingAccess = false,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      onSnapshotChange(next);
      setChoosing(false);
      if (requestingAccess && next.state === 'not_determined') {
        setError(
          'macOS did not show a Calendar access prompt. Check Privacy & Security → Calendars in System Settings, then try again.',
        );
      }
    } catch {
      setError('Calendar couldn’t be updated. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const availableCalendars = snapshot?.calendars ?? [];
  const availableMap = new Map(
    availableCalendars.map((c) => [c.identifier, c]),
  );
  const missingSelected = selectedList.filter(
    (c) => !availableMap.has(c.identifier),
  );

  const allCandidates: {
    descriptor: CalendarDescriptor;
    isMissing: boolean;
  }[] = [
    ...availableCalendars.map((descriptor) => ({
      descriptor,
      isMissing: false,
    })),
    ...missingSelected.map((descriptor) => ({
      descriptor,
      isMissing: true,
    })),
  ];

  const groupedBySource = new Map<string, typeof allCandidates>();
  for (const candidate of allCandidates) {
    const source = candidate.descriptor.sourceTitle || 'Other';
    const list = groupedBySource.get(source) ?? [];
    list.push(candidate);
    groupedBySource.set(source, list);
  }

  const toggleStaged = (id: string) => {
    setStagedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const currentSelectedIds = new Set(selectedList.map((c) => c.identifier));
  const isUnchanged =
    stagedIds.size === currentSelectedIds.size &&
    Array.from(stagedIds).every((id) => currentSelectedIds.has(id));

  const saveDisabled = busy || stagedIds.size === 0 || isUnchanged;

  const handleSave = () => {
    const chosenMap = new Map(
      allCandidates.map((c) => [c.descriptor.identifier, c.descriptor]),
    );
    const chosen = Array.from(stagedIds)
      .map((id) => chosenMap.get(id))
      .filter((c): c is CalendarDescriptor => Boolean(c));
    return run(() => selectCalendars(chosen));
  };

  const needsChoice =
    snapshot?.state === 'needs_selection' ||
    snapshot?.state === 'selected_calendar_missing' ||
    choosing;

  return (
    <section className="mb-10" aria-labelledby="calendar-context-title">
      <h3
        id="calendar-context-title"
        className="mb-3 ml-1 text-[13px] font-semibold text-pro-text-main"
      >
        Calendar context
      </h3>
      <div className="overflow-hidden rounded-xl border border-pro-border/60 bg-pro-surface shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pro-accent/8 text-pro-accent">
              <CalendarDays className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-pro-text-main">
                One calendar, already on this Mac
              </p>
              <p className="mt-1 max-w-[58ch] text-[12px] leading-5 text-pro-text-muted">
                Pluto reads event titles, times, and participants locally to
                identify meetings and show what’s next. No account or hosted
                service is required.
              </p>
              <p className="mt-2 max-w-[58ch] text-[11px] leading-5 text-pro-text-muted/80">
                macOS grants full Calendar access for event reads. Pluto only
                reads events and provides no calendar editing actions.
              </p>
            </div>
          </div>

          {!snapshot ? (
            <Loader2 className="h-4 w-4 animate-spin text-pro-text-muted" />
          ) : snapshot.state === 'not_determined' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(connectCalendar, true)}
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-pro-accent px-4 text-[12px] font-semibold text-white transition-colors hover:bg-pro-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-50"
            >
              {busy ? 'Connecting…' : 'Connect Calendar'}
            </button>
          ) : null}
        </div>

        {snapshot?.state === 'denied' || snapshot?.state === 'restricted' ? (
          <div className="flex flex-col gap-3 border-t border-pro-border/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-5 text-pro-text-muted">
              Calendar access is off. Recording still works normally.
            </p>
            <SecondaryButton
              ariaLabel="Open Calendar privacy settings"
              onClick={() => void openCalendarSystemSettings('privacy')}
            >
              Open System Settings
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </SecondaryButton>
          </div>
        ) : null}

        {snapshot?.state === 'no_calendars' ? (
          <div className="flex flex-col gap-3 border-t border-pro-border/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-5 text-pro-text-muted">
              No event calendars were found. Add an account to macOS, then try
              again.
            </p>
            <SecondaryButton
              onClick={() => void openCalendarSystemSettings('accounts')}
            >
              Open Internet Accounts
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </SecondaryButton>
          </div>
        ) : null}

        {needsChoice ? (
          <div className="border-t border-pro-border/40 px-5 py-4">
            <p className="text-[12px] font-semibold text-pro-text-main">
              {snapshot?.state === 'selected_calendar_missing'
                ? 'Resolve missing calendar'
                : 'Choose calendars'}
            </p>
            <p className="mt-0.5 text-[11px] text-pro-text-muted">
              Pluto will read events from every selected calendar.
            </p>
            <div className="mt-3 space-y-4">
              {Array.from(groupedBySource.entries()).map(([source, items]) => (
                <div key={source}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-pro-text-muted/70">
                    {source}
                  </p>
                  <div className="divide-y divide-pro-border/50 rounded-lg border border-pro-border/60 bg-pro-bg">
                    {items.map(({ descriptor: calendar, isMissing }) => {
                      const isChecked = stagedIds.has(calendar.identifier);
                      return (
                        <label
                          key={calendar.identifier}
                          className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-pro-surface"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleStaged(calendar.identifier)}
                            className="h-3.5 w-3.5 rounded border-pro-border/70 text-pro-accent focus:ring-pro-accent"
                            aria-label={`${calendar.title} from ${calendar.sourceTitle}${isMissing ? ' (Missing)' : ''}`}
                          />
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full bg-pro-accent"
                            style={
                              calendar.colorHex
                                ? { backgroundColor: calendar.colorHex }
                                : undefined
                            }
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="block truncate text-[13px] font-medium text-pro-text-main">
                                {calendar.title}
                              </span>
                              {isMissing ? (
                                <span className="rounded bg-pro-urgent/15 px-1.5 py-0.5 text-[9px] font-semibold text-pro-urgent">
                                  Missing
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-[10px] font-medium text-pro-text-muted">
                              {calendar.sourceTitle}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                aria-label="Save changes"
                disabled={saveDisabled}
                onClick={() => void handleSave()}
                className="inline-flex min-h-9 items-center justify-center rounded-lg bg-pro-accent px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-pro-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              {choosing && snapshot?.enabled && snapshot.state === 'ready' ? (
                <SecondaryButton
                  onClick={() => {
                    setChoosing(false);
                    setStagedIds(
                      new Set(selectedList.map((c) => c.identifier)),
                    );
                  }}
                >
                  Cancel
                </SecondaryButton>
              ) : null}
            </div>
          </div>
        ) : null}

        {snapshot?.enabled && selectedList.length > 0 && !needsChoice ? (
          <div className="border-t border-pro-border/40 px-5 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-medium text-pro-text-main">
                  <CheckCircle2
                    className="h-4 w-4 text-pro-success"
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {selectedList.length > 1
                      ? `${selectedList.length} calendars`
                      : selectedList[0].title}
                  </span>
                  <span className="font-normal text-pro-text-muted">
                    {selectedList.length > 1
                      ? `· ${selectedList.map((c) => c.title).join(', ')}`
                      : `· ${selectedList[0].sourceTitle}`}
                  </span>
                </p>
                <p className="mt-1 text-[10px] font-medium text-pro-text-muted">
                  {snapshot.lastReadAt
                    ? `Last read from this Mac ${new Date(snapshot.lastReadAt).toLocaleString()}`
                    : 'Waiting for the first local read'}
                </p>
                {snapshot.state === 'read_failed' ? (
                  <p className="mt-1 text-[10px] font-semibold text-pro-warning">
                    The last snapshot is preserved while Pluto retries.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton
                  disabled={busy}
                  onClick={() => void run(refreshCalendar)}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  Refresh
                </SecondaryButton>
                <SecondaryButton
                  disabled={busy}
                  onClick={() => setChoosing(true)}
                >
                  Change calendar
                </SecondaryButton>
                <SecondaryButton
                  disabled={busy}
                  onClick={() => void run(disconnectCalendar)}
                >
                  <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
                  Disconnect
                </SecondaryButton>
              </div>
            </div>
          </div>
        ) : null}

        {snapshot?.state === 'runtime_missing' ||
        snapshot?.state === 'unsupported_platform' ? (
          <p className="border-t border-pro-border/40 px-5 py-4 text-[12px] text-pro-text-muted">
            Native Calendar context isn’t available in this build.
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="border-t border-pro-border/40 px-5 py-3 text-[11px] font-semibold text-pro-urgent"
          >
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void openCalendarSystemSettings('privacy')}
              className="mt-1 underline"
            >
              Open Calendar settings
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
};
