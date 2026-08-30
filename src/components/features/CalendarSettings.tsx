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
  selectCalendar,
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

  const run = async (action: () => Promise<CalendarIntegrationSnapshot>) => {
    setBusy(true);
    setError(null);
    try {
      onSnapshotChange(await action());
    } catch {
      setError('Calendar couldn’t be updated. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const choose = (calendar: CalendarDescriptor) =>
    run(async () => {
      const next = await selectCalendar(calendar);
      setChoosing(false);
      return next;
    });

  const calendars = snapshot?.calendars ?? [];
  const needsChoice = snapshot?.state === 'needs_selection' || choosing;

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
              onClick={() => void run(connectCalendar)}
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
              Choose one calendar
            </p>
            <div className="mt-3 divide-y divide-pro-border/50 rounded-lg border border-pro-border/60 bg-pro-bg">
              {calendars.map((calendar) => (
                <button
                  key={calendar.identifier}
                  type="button"
                  aria-label={`Use ${calendar.title} calendar from ${calendar.sourceTitle}`}
                  disabled={busy}
                  onClick={() => void choose(calendar)}
                  className="flex min-h-12 w-full items-center gap-3 px-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-pro-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-50"
                >
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
                    <span className="block truncate text-[13px] font-medium text-pro-text-main">
                      {calendar.title}
                    </span>
                    <span className="block truncate text-[10px] font-medium text-pro-text-muted">
                      {calendar.sourceTitle}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {snapshot?.enabled && snapshot.selectedCalendar && !needsChoice ? (
          <div className="border-t border-pro-border/40 px-5 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-medium text-pro-text-main">
                  <CheckCircle2
                    className="h-4 w-4 text-pro-success"
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {snapshot.selectedCalendar.title}
                  </span>
                  <span className="font-normal text-pro-text-muted">
                    · {snapshot.selectedCalendar.sourceTitle}
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
          <p
            role="alert"
            className="border-t border-pro-border/40 px-5 py-3 text-[11px] font-semibold text-pro-urgent"
          >
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
};
