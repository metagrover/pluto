import { ChevronDown, RefreshCw, Sparkles } from 'lucide-react';
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
}: {
  prep: MeetingPrep;
  onOpenMeeting?: (id: string) => void;
  regeneration: number;
  onRegenerate: () => void;
  disabled?: boolean;
}) {
  const [brief, setBrief] = useState<PreMeetingBrief | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const lastRegeneration = useRef(0);
  const contextKey = JSON.stringify(prep.meetings || []);
  useEffect(() => {
    let current = true;
    const synthesize = regeneration !== lastRegeneration.current;
    lastRegeneration.current = regeneration;
    setBrief(null);
    setError(false);
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
          if (current) setBrief(generated);
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
  }, [prep.occurrenceKey, contextKey, regeneration]);
  if (!(prep.meetings || []).length) return null;
  const overview = brief?.overview?.length
    ? brief.overview
    : brief?.lastTime || [];
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
    ...(brief?.talkingPoints || []).slice(0, 1),
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
  const visibleBullets = bullets.slice(0, 6);
  const openItems = brief?.stillOpen || [];
  const sources = Array.from(
    new Map(
      [...visibleBullets, ...openItems]
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
      className="rounded-2xl border border-pro-border bg-pro-surface/15 p-5 sm:p-6"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-pro-accent">
          <Sparkles size={14} aria-hidden="true" className="shrink-0" />
          Executive briefing
        </h3>
        <button
          type="button"
          disabled={disabled || generating}
          onClick={onRegenerate}
          className="inline-flex min-h-8 items-center gap-2 rounded-md px-2 text-xs text-pro-text-muted hover:bg-pro-surface hover:text-pro-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-50"
        >
          <RefreshCw
            size={13}
            className={generating ? 'motion-safe:animate-spin' : undefined}
            aria-hidden="true"
          />
          Regenerate
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-3 text-xs text-pro-text-muted">
          Briefing could not be generated. Saved meeting context is available
          below.
        </p>
      )}
      {generating && <MeetingPrepBriefSkeleton />}
      {!generating && !!visibleBullets.length && (
        <ul className="space-y-4">
          {visibleBullets.map((item) => {
            const number =
              sources.findIndex(
                (source) => source.sourceMeetingId === item.sourceMeetingId,
              ) + 1;
            const short = excerpt(item.text);
            return (
              <li
                key={item.id}
                className="flex items-start gap-3 text-sm leading-6 text-pro-text-main"
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-1.5 shrink-0 items-center"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-pro-accent" />
                </span>
                <div className="min-w-0 flex-1">
                  <span>{short}</span>
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
                  {short !== item.text && (
                    <details className="group/context mt-1 text-xs text-pro-text-muted">
                      <summary className="flex min-h-6 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent [&::-webkit-details-marker]:hidden">
                        Read full context
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
      {!generating && brief && !visibleBullets.length && !openItems.length && (
        <p className="text-sm text-pro-text-muted">
          The selected meetings have no saved discussion notes.
        </p>
      )}
      {!generating && !!openItems.length && (
        <div className="mt-5 border-t border-pro-border pt-4">
          <h4 className="mb-3 text-xs font-medium text-pro-text-muted">
            Open action items
          </h4>
          <ul className="space-y-3">
            {openItems.map((item) => {
              const number =
                sources.findIndex(
                  (source) => source.sourceMeetingId === item.sourceMeetingId,
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
                    <span className="h-1.5 w-1.5 rounded-full bg-pro-accent" />
                  </span>
                  <span>
                    {item.text}
                    {item.sourceMeetingId && (
                      <button
                        type="button"
                        aria-label={`Open action item source: ${item.sourceLabel}`}
                        title={`${item.sourceLabel}${item.sourceDate ? ` · ${formatPrepDate(item.sourceDate)}` : ''}`}
                        onClick={() => onOpenMeeting?.(item.sourceMeetingId!)}
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
      )}
      {!generating && !!sources.length && (
        <details className="group/sources mt-5 text-xs text-pro-text-muted">
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
