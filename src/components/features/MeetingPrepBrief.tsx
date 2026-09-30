import { ChevronDown, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MeetingPrep } from '../../../electron/meetingPrep';
import type { PreMeetingBrief } from '../../../electron/preMeetingBrief';
import { buildPrepBrief, synthesizePrepBrief } from '../../api/meetingPrep';
import { formatPrepDate } from '../../utils/meetingPrepPresentation';
export function MeetingPrepBriefSkeleton() {
  return (
    <div
      role="status"
      aria-label="Preparing meeting briefing"
      className="space-y-5 motion-safe:animate-pulse"
    >
      <span className="sr-only">Preparing meeting briefing…</span>
      {[0, 1, 2].map((index) => (
        <div key={index} aria-hidden="true" className="flex gap-3">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pro-text-muted/20" />
          <div className="flex-1 space-y-2">
            <div
              className={`h-3 rounded bg-pro-text-muted/15 ${index === 1 ? 'w-4/5' : 'w-full'}`}
            />
            <div
              className={`h-3 rounded bg-pro-text-muted/10 ${index === 2 ? 'w-1/2' : 'w-2/3'}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
export function MeetingPrepBrief({
  prep,
  onOpenMeeting,
  regeneration,
  onRegenerate,
  disabled = false,
  readOnly = false,
}: {
  prep: MeetingPrep;
  onOpenMeeting?: (id: string) => void;
  regeneration: number;
  onRegenerate: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const [brief, setBrief] = useState<PreMeetingBrief | null>(
    prep.briefing ?? null,
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const lastRegeneration = useRef(0);
  const contextKey = JSON.stringify(prep.meetings || []);
  const previousContextKey = useRef(contextKey);
  useEffect(() => {
    let current = true;
    const synthesize = regeneration !== lastRegeneration.current;
    lastRegeneration.current = regeneration;
    if (previousContextKey.current !== contextKey) setBrief(null);
    previousContextKey.current = contextKey;
    setError(false);
    if (readOnly) {
      setBrief(
        prep.briefing?.synthesisStatus === 'ready' ? prep.briefing : null,
      );
      setGenerating(false);
      // The saved synthesis stays fixed, while current commitment status is
      // reconciled without running another model request.
      try {
        void buildPrepBrief(prep.occurrenceKey)
          .then((value) => {
            if (current && value.synthesisStatus === 'ready') setBrief(value);
          })
          .catch(() => {});
      } catch {
        // Retain the saved briefing if the IPC bridge is unavailable.
      }
      return () => {
        current = false;
      };
    }
    if (!(prep.meetings || []).length) {
      setGenerating(false);
      return;
    }
    setGenerating(true);
    void buildPrepBrief(prep.occurrenceKey)
      .then((value) => {
        if (!current) return;
        setBrief(value);
        if (!synthesize) return;
        return synthesizePrepBrief(prep.occurrenceKey).then((generated) => {
          if (!current) return;
          if (generated.synthesisStatus === 'ready') setBrief(generated);
          else setError(true);
        });
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setGenerating(false);
      });
    return () => {
      current = false;
    };
  }, [prep.occurrenceKey, prep.briefing, contextKey, regeneration, readOnly]);
  if (!(prep.meetings || []).length) return null;
  const overview = brief?.overview?.length
    ? brief.overview
    : brief?.lastTime || [];
  const isNarrative =
    brief?.synthesisStatus === 'ready' && overview.some((item) => item.summary);
  const represented = new Set(overview.map((item) => item.sourceMeetingId));
  const additional = (prep.meetings || []).flatMap((meeting) => {
    if (represented.has(meeting.id)) return [];
    const item = (brief?.evidenceItems || brief?.lastTime || []).find(
      (candidate) => candidate.sourceMeetingId === meeting.id,
    );
    return item ? [item] : [];
  });
  const candidates = [
    ...overview.slice(0, 2),
    ...additional,
    ...overview.slice(2),
  ];
  const bullets = candidates.filter(
    (item, index) =>
      !candidates
        .slice(0, index)
        .some(
          (previous) =>
            previous.text.trim().toLowerCase() ===
            item.text.trim().toLowerCase(),
        ),
  );
  const visibleBullets = isNarrative
    ? overview.slice(0, 4)
    : bullets.slice(0, 6);
  const openItems = brief?.stillOpen || [];
  const possibleNextSteps = brief?.possibleNextSteps || [];
  const watchouts = brief?.watchouts || [];
  const myCommitments = openItems.filter((item) => item.ownerScope === 'self');
  const otherCommitments = openItems.filter(
    (item) => item.ownerScope === 'other',
  );
  const unconfirmedCommitments = openItems.filter(
    (item) => item.ownerScope !== 'self' && item.ownerScope !== 'other',
  );
  const sources = Array.from(
    new Map(
      [...visibleBullets, ...openItems, ...possibleNextSteps, ...watchouts]
        .filter((item) => item.sourceMeetingId)
        .map((item) => [item.sourceMeetingId!, item]),
    ).values(),
  );
  const excerpt = (text: string) => {
    if (text.length <= 220) return text;
    const sentence = text.match(/^.{30,220}?[.!?](?=\s|$)/)?.[0];
    if (sentence) return sentence;
    const cut = text.slice(0, 220);
    return `${cut.slice(0, cut.lastIndexOf(' ') > 150 ? cut.lastIndexOf(' ') : 220)}…`;
  };
  return (
    <section
      aria-label="Meeting briefing"
      aria-busy={generating}
      className="pb-2"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 max-w-[60ch]">
          <h3 className="text-xl font-semibold leading-7 tracking-[-0.012em] text-pro-text-main">
            Meeting prep
          </h3>
          {error && (
            <p
              role="alert"
              className="mt-1.5 text-xs leading-5 text-pro-text-muted"
            >
              {brief?.synthesisStatus === 'ready'
                ? 'Could not refresh the recap. The last successful version is still shown.'
                : 'Could not generate a recap. Saved meeting excerpts are shown below.'}
            </p>
          )}
          {generating && brief && (
            <p
              role="status"
              className="mt-1.5 text-xs leading-5 text-pro-text-muted"
            >
              Generating recap…
            </p>
          )}
          {brief?.synthesisStatus === 'fallback' && !generating && !error && (
            <p className="mt-1.5 text-xs leading-5 text-pro-text-muted">
              Showing saved excerpts. Regenerate to choose highlights.
            </p>
          )}
        </div>
        {!readOnly && (
          <button
            type="button"
            disabled={disabled || generating}
            onClick={onRegenerate}
            className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-xs font-medium text-pro-text-muted hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={generating ? 'motion-safe:animate-spin' : undefined}
              aria-hidden="true"
            />
            Regenerate
          </button>
        )}
      </div>
      {generating && !brief && <MeetingPrepBriefSkeleton />}
      {!!visibleBullets.length && (
        <div>
          <h4 className="mb-3 text-[15px] font-semibold text-pro-text-main">
            Last discussion
          </h4>
          {isNarrative ? (
            <>
              <p className="max-w-prose text-[15px] leading-7 text-pro-text-main">
                {visibleBullets.map((item, index) => {
                  const number =
                    sources.findIndex(
                      (source) =>
                        source.sourceMeetingId === item.sourceMeetingId,
                    ) + 1;
                  return (
                    <span key={item.id}>
                      {index > 0 ? ' ' : ''}
                      {item.summary || item.text}
                      {item.sourceMeetingId && (
                        <button
                          type="button"
                          aria-label={`Open source: ${item.sourceLabel}`}
                          title={`${item.sourceLabel}${item.sourceDate ? ` · ${formatPrepDate(item.sourceDate)}` : ''}`}
                          onClick={() => onOpenMeeting?.(item.sourceMeetingId!)}
                          className="ml-1 rounded-sm align-super text-[10px] leading-none text-pro-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                        >
                          [{number}]
                        </button>
                      )}
                    </span>
                  );
                })}
              </p>
              <details className="group/context mt-3 text-xs text-pro-text-muted">
                <summary className="flex min-h-6 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent [&::-webkit-details-marker]:hidden">
                  Read supporting excerpts
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 transition-transform group-open/context:rotate-180"
                  />
                </summary>
                <ul className="mt-2 space-y-2 pl-4">
                  {visibleBullets.map((item) => (
                    <li key={item.id} className="list-disc leading-5">
                      {item.sourceQuote || item.text}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <ul className="max-w-[68ch] space-y-3">
              {visibleBullets.map((item) => {
                const number =
                  sources.findIndex(
                    (source) => source.sourceMeetingId === item.sourceMeetingId,
                  ) + 1;
                const short = item.summary || excerpt(item.text);
                return (
                  <li
                    key={item.id}
                    className="flex items-start gap-2.5 text-sm leading-6 text-pro-text-main"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-1.5 shrink-0 items-center"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-pro-text-muted/60" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span>{short}</span>
                      {item.trustStatus !== 'grounded' &&
                        !!item.trustStatus && (
                          <span className="ml-2 text-xs text-pro-text-muted">
                            {item.trustStatus === 'stale'
                              ? 'Source may be outdated'
                              : item.trustStatus === 'inferred'
                                ? 'Suggested interpretation'
                                : 'Needs review'}
                          </span>
                        )}
                      {item.sourceMeetingId && (
                        <button
                          type="button"
                          aria-label={`Open source: ${item.sourceLabel}`}
                          title={`${item.sourceLabel}${item.sourceDate ? ` · ${formatPrepDate(item.sourceDate)}` : ''}`}
                          onClick={() => onOpenMeeting?.(item.sourceMeetingId!)}
                          className="relative -top-0.5 ml-1.5 text-[10px] leading-none text-pro-accent"
                        >
                          [{number}]
                        </button>
                      )}
                      {(short !== item.text || item.sourceQuote) && (
                        <details className="group/context mt-1 text-xs text-pro-text-muted">
                          <summary className="flex min-h-6 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent [&::-webkit-details-marker]:hidden">
                            {item.summary
                              ? 'Read source excerpt'
                              : 'Read full context'}
                            <ChevronDown
                              size={16}
                              aria-hidden="true"
                              className="shrink-0 motion-reduce:transition-none transition-transform group-open/context:rotate-180"
                            />
                          </summary>
                          <p className="mt-2 text-xs leading-5 text-pro-text-muted">
                            {item.text}
                          </p>
                        </details>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {!generating && brief && !visibleBullets.length && !openItems.length && (
        <p className="text-sm text-pro-text-muted">
          The selected meetings have no saved discussion notes.
        </p>
      )}
      {!!openItems.length && (
        <div className="mt-9">
          {(
            [
              ['Your commitments', myCommitments],
              ['Other commitments', otherCommitments],
              ['Ownership unconfirmed', unconfirmedCommitments],
            ] as const
          ).map(
            ([heading, items]) =>
              !!items.length && (
                <div key={heading} className="mb-6 last:mb-0">
                  <h4 className="mb-3 text-[15px] font-semibold text-pro-text-main">
                    {heading}
                  </h4>
                  <ul className="max-w-[68ch] space-y-3">
                    {items.map((item) => {
                      const number =
                        sources.findIndex(
                          (source) =>
                            source.sourceMeetingId === item.sourceMeetingId,
                        ) + 1;
                      return (
                        <li
                          key={item.id}
                          className="flex items-start gap-3 text-sm leading-6 text-pro-text-main"
                        >
                          <span
                            aria-hidden="true"
                            className="flex h-6 w-1.5 shrink-0 items-center"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-pro-text-muted/60" />
                          </span>
                          <span>
                            {item.text}
                            {item.sourceMeetingId && (
                              <button
                                type="button"
                                aria-label={`Open action item source: ${item.sourceLabel}`}
                                title={`${item.sourceLabel}${item.sourceDate ? ` · ${formatPrepDate(item.sourceDate)}` : ''}`}
                                onClick={() =>
                                  onOpenMeeting?.(item.sourceMeetingId!)
                                }
                                className="ml-1.5 rounded-sm text-xs text-pro-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                              >
                                [{number}]
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ),
          )}
        </div>
      )}
      {(
        [
          ['Possible next steps', possibleNextSteps],
          ['Things to watch', watchouts],
        ] as const
      ).map(
        ([heading, items]) =>
          !!items.length && (
            <section key={heading} className="mt-9">
              <h4 className="mb-3 text-[15px] font-semibold text-pro-text-main">
                {heading}
              </h4>
              <ul className="max-w-[68ch] space-y-3">
                {items.map((item) => {
                  const number =
                    sources.findIndex(
                      (source) =>
                        source.sourceMeetingId === item.sourceMeetingId,
                    ) + 1;
                  return (
                    <li
                      key={item.id}
                      className="text-sm leading-6 text-pro-text-main"
                    >
                      {item.summary || item.text}
                      {item.sourceMeetingId && (
                        <button
                          type="button"
                          aria-label={`Open source: ${item.sourceLabel}`}
                          title={`${item.sourceLabel}${item.sourceDate ? ` · ${formatPrepDate(item.sourceDate)}` : ''}`}
                          onClick={() => onOpenMeeting?.(item.sourceMeetingId!)}
                          className="ml-1 rounded-sm align-super text-[10px] leading-none text-pro-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                        >
                          [{number}]
                        </button>
                      )}
                      {item.sourceQuote && (
                        <details className="mt-1 text-xs text-pro-text-muted">
                          <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent">
                            {item.sourceMeetingId
                              ? 'Supporting excerpt'
                              : 'Calendar agenda excerpt'}
                          </summary>
                          <p className="mt-1 leading-5">{item.sourceQuote}</p>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
      )}
      {!!sources.length && (
        <details className="group/sources mt-7 text-xs text-pro-text-muted">
          <summary className="flex min-h-6 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent [&::-webkit-details-marker]:hidden">
            Sources · {sources.length}
            <ChevronDown
              size={16}
              aria-hidden="true"
              className="shrink-0 motion-reduce:transition-none transition-transform group-open/sources:rotate-180"
            />
          </summary>
          <div className="mt-2 space-y-2">
            {sources.map((source, index) => (
              <button
                key={source.sourceMeetingId}
                type="button"
                onClick={() => onOpenMeeting?.(source.sourceMeetingId!)}
                className="block text-left hover:text-pro-accent"
              >
                [{index + 1}] {source.sourceLabel}
                {source.sourceDate
                  ? ` · ${formatPrepDate(source.sourceDate)}`
                  : ''}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
