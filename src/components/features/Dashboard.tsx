import {
  ArrowRight,
  CalendarPlus,
  Check,
  ChevronRight,
  CircleDot,
  Loader2,
  PartyPopper,
  Sparkles,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, FormEvent, RefObject } from 'react';

import type {
  DashboardAction,
  DashboardActionInsightItem,
  DashboardHomeModel,
  DashboardTopOfMindItem,
} from './dashboardModel';

interface DashboardProps {
  model: DashboardHomeModel;
  loading: boolean;
  isRecording: boolean;
  setSelectedMeetingId: (id: string | number | null) => void;
  setActiveTab: (
    tab: 'hub' | 'people' | 'projects' | 'wiki' | 'meetings' | 'chat',
  ) => void;
  setAskPlutoVisible?: (visible: boolean) => void;
  updatingTaskIds: Set<string>;
  actionError: string | null;
  handleCompleteTask: (id: string) => Promise<void>;
  handleReviewCommitment?: (
    id: string,
    state: 'confirmed' | 'rejected',
  ) => Promise<void>;
  handleCreateCommitment?: (
    text: string,
    dueDate: string | null,
  ) => Promise<void>;
  handleUpdateAttentionStatus?: (
    attentionItemId: string,
    nextStatus: 'active' | 'dismissed' | 'snoozed',
  ) => Promise<void>;
}

const getActionInsightStatusTone = (item: DashboardActionInsightItem) => {
  if (item.commitmentState === 'possible') {
    return 'bg-pro-warning/10 text-pro-warning';
  }
  if (item.attentionLabel === 'Blocker' || item.status === 'overdue') {
    return 'bg-pro-urgent/10 text-pro-urgent';
  }
  if (item.status === 'stale') {
    return 'bg-pro-warning/10 text-pro-warning';
  }
  return 'bg-pro-accent/10 text-pro-accent';
};

const getActionInsightPrimaryLabel = (item: DashboardActionInsightItem) =>
  item.attentionLabel === 'Blocker' && item.attentionStatus === 'active'
    ? 'Resolve blocker'
    : 'Mark complete';

const getActionInsightPrimaryAriaLabel = (item: DashboardActionInsightItem) =>
  item.attentionLabel === 'Blocker' && item.attentionStatus === 'active'
    ? `Resolve blocker: ${item.title}`
    : `Mark ${item.title} complete`;

interface DashboardReviewAction {
  label: 'Review source' | 'Confirm task' | 'Not a task';
  ariaLabel: string;
  onClick: () => void | Promise<void>;
}

export const getDashboardReviewActions = (
  item: DashboardActionInsightItem,
  handlers: {
    setSelectedMeetingId: (id: string | number | null) => void;
    handleReviewCommitment: (
      id: string,
      state: 'confirmed' | 'rejected',
    ) => Promise<void>;
  },
): DashboardReviewAction[] => [
  ...(item.sourceMeetingId
    ? [
        {
          label: 'Review source' as const,
          ariaLabel: `Review source for ${item.title}`,
          onClick: () => handlers.setSelectedMeetingId(item.sourceMeetingId),
        },
      ]
    : []),
  {
    label: 'Confirm task',
    ariaLabel: `Confirm task: ${item.title}`,
    onClick: () => handlers.handleReviewCommitment(item.id, 'confirmed'),
  },
  {
    label: 'Not a task',
    ariaLabel: `Not a task: ${item.title}`,
    onClick: () => handlers.handleReviewCommitment(item.id, 'rejected'),
  },
];

const getHeroTone = (
  severity: DashboardHomeModel['hero']['severity'],
  loading: boolean,
) => {
  if (loading) return 'border-pro-border text-pro-text-muted';
  if (severity === 'urgent') return 'border-pro-urgent/25 text-pro-urgent';
  if (severity === 'watch') return 'border-pro-warning/25 text-pro-warning';
  if (severity === 'live') return 'border-pro-success/25 text-pro-success';
  return 'border-pro-accent/25 text-pro-accent';
};

const formatMeetingDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
};

const CURRENT_READ_CLAIM_ID = 'dashboard-current-read-claim';

export const shouldUseReducedDashboardMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export const buildDashboardConfettiPieces = () =>
  Array.from({ length: 28 }, (_, index) => ({
    id: `confetti-${index}`,
    left: `${(index * 37) % 100}%`,
    delay: `${(index % 7) * 80}ms`,
    duration: `${900 + (index % 5) * 120}ms`,
  }));

const getTopOfMindTone = (item: DashboardTopOfMindItem): string => {
  if (item.trustState === 'weak')
    return 'border-pro-warning/25 text-pro-warning';
  if (item.trustState === 'stale')
    return 'border-pro-warning/25 text-pro-warning';
  if (item.trustState === 'directly supported')
    return 'border-pro-accent/25 text-pro-accent';
  return 'border-pro-border text-pro-text-muted';
};

export interface CurrentReadClaimState {
  claimIdentity: string;
  expanded: boolean;
  isClipped: boolean;
}

export type CurrentReadClaimAction =
  | { type: 'toggle' }
  | { type: 'measured'; isClipped: boolean }
  | { type: 'claim-changed'; claimIdentity: string };

export const reduceCurrentReadClaimState = (
  state: CurrentReadClaimState,
  action: CurrentReadClaimAction,
): CurrentReadClaimState => {
  if (action.type === 'toggle') {
    return { ...state, expanded: !state.expanded };
  }
  if (action.type === 'measured') {
    return { ...state, isClipped: action.isClipped };
  }
  if (action.claimIdentity === state.claimIdentity) return state;
  return {
    claimIdentity: action.claimIdentity,
    expanded: false,
    isClipped: false,
  };
};

export const CurrentReadClaimView = ({
  claim,
  expanded,
  isClipped,
  onToggle,
  claimRef,
}: {
  claim: string;
  expanded: boolean;
  isClipped: boolean;
  onToggle: () => void;
  claimRef?: RefObject<HTMLHeadingElement>;
}) => (
  <>
    <h1
      ref={claimRef}
      id={CURRENT_READ_CLAIM_ID}
      className={`max-w-[36ch] break-words text-[24px] font-semibold leading-[1.22] text-pro-text-main [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-3'}`}
    >
      {claim}
    </h1>
    {isClipped ? (
      <button
        id="dashboard-current-read-disclosure"
        type="button"
        aria-controls={CURRENT_READ_CLAIM_ID}
        aria-expanded={expanded}
        onClick={onToggle}
        className="mt-3 min-h-8 text-[11px] font-bold text-pro-accent hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
      >
        {expanded ? 'Collapse current read' : 'Show full current read'}
      </button>
    ) : null}
  </>
);

export const isCurrentReadClaimClipped = (element: {
  scrollHeight: number;
  clientHeight: number;
}) => element.scrollHeight > element.clientHeight + 1;

export const CurrentReadClaim = ({ claim }: { claim: string }) => {
  const claimRef = useRef<HTMLHeadingElement>(null);
  const [state, dispatch] = useReducer(reduceCurrentReadClaimState, {
    claimIdentity: claim,
    expanded: false,
    isClipped: false,
  });
  const { expanded, isClipped } = state;

  const measureOverflow = useCallback(() => {
    const claimElement = claimRef.current;
    if (!claimElement) return;
    const lineHeight = Number.parseFloat(
      window.getComputedStyle(claimElement).lineHeight,
    );
    const collapsedHeight = expanded
      ? lineHeight * 3
      : claimElement.clientHeight;
    dispatch({
      type: 'measured',
      isClipped: isCurrentReadClaimClipped({
        scrollHeight: claimElement.scrollHeight,
        clientHeight: Number.isFinite(collapsedHeight)
          ? collapsedHeight
          : claimElement.clientHeight,
      }),
    });
  }, [expanded]);

  useLayoutEffect(() => {
    dispatch({ type: 'claim-changed', claimIdentity: claim });
  }, [claim]);

  useLayoutEffect(() => {
    measureOverflow();

    const claimElement = claimRef.current;
    if (!claimElement) return;

    const resizeObserver = new ResizeObserver(measureOverflow);
    resizeObserver.observe(claimElement);

    const fonts = document.fonts;
    void fonts?.ready.then(measureOverflow);
    fonts?.addEventListener('loadingdone', measureOverflow);

    return () => {
      resizeObserver.disconnect();
      fonts?.removeEventListener('loadingdone', measureOverflow);
    };
  }, [measureOverflow]);

  return (
    <CurrentReadClaimView
      claim={claim}
      expanded={expanded}
      isClipped={isClipped}
      onToggle={() => dispatch({ type: 'toggle' })}
      claimRef={claimRef}
    />
  );
};

export const Dashboard = ({
  model,
  loading,
  isRecording,
  setSelectedMeetingId,
  setActiveTab,
  updatingTaskIds,
  actionError,
  handleCompleteTask,
  handleReviewCommitment = async () => {},
  handleCreateCommitment = async () => {},
  handleUpdateAttentionStatus = async () => {},
}: DashboardProps) => {
  const [addingCommitment, setAddingCommitment] = useState(false);
  const [commitmentText, setCommitmentText] = useState('');
  const [commitmentDueDate, setCommitmentDueDate] = useState('');
  const [isCreatingCommitment, setIsCreatingCommitment] = useState(false);
  const [celebration, setCelebration] = useState<
    'idle' | 'confetti' | 'reduced'
  >('idle');

  const runAction = (action: DashboardAction) => {
    if (action.target === 'ask') return setActiveTab('chat');
    if (action.target === 'meeting')
      return setSelectedMeetingId(action.meetingId);
    setActiveTab(action.target);
  };

  useEffect(() => {
    if (celebration === 'idle') return;
    const timeout = window.setTimeout(() => setCelebration('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [celebration]);

  const submitCommitment = async (event: FormEvent) => {
    event.preventDefault();
    const text = commitmentText.trim();
    if (!text || isCreatingCommitment) return;

    setIsCreatingCommitment(true);
    try {
      await handleCreateCommitment(text, commitmentDueDate || null);
      setCommitmentText('');
      setCommitmentDueDate('');
      setAddingCommitment(false);
    } finally {
      setIsCreatingCommitment(false);
    }
  };

  const startCelebration = () => {
    setCelebration(shouldUseReducedDashboardMotion() ? 'reduced' : 'confetti');
  };

  const topOfMindItems =
    model.topOfMind.state === 'populated' ? model.topOfMind.items : [];
  const recentWin = model.recentWin;
  const latestMeeting = model.latestMeeting;
  const commitmentItems =
    model.commitments.state === 'populated' ? model.commitments.items : [];
  const hiddenCommitmentCount =
    model.actionInsights.state === 'populated'
      ? Math.max(
          0,
          model.actionInsights.items.filter(
            (item) => item.commitmentState === 'confirmed',
          ).length - commitmentItems.length,
        )
      : 0;
  const confettiPieces = buildDashboardConfettiPieces();

  return (
    <main className="relative mx-auto w-full max-w-[1180px] animate-in pb-20">
      {celebration === 'confetti' ? (
        <div
          aria-hidden="true"
          data-testid="dashboard-confetti"
          className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
        >
          {confettiPieces.map((piece) => (
            <span
              key={piece.id}
              className="absolute top-[-16px] h-2.5 w-1.5 animate-[dashboard-confetti-fall_var(--duration)_ease-out_var(--delay)_forwards] rounded-sm bg-pro-accent odd:bg-pro-success even:bg-pro-warning"
              style={
                {
                  left: piece.left,
                  '--delay': piece.delay,
                  '--duration': piece.duration,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
      {celebration === 'reduced' ? (
        <output
          data-testid="dashboard-reduced-celebration"
          className="fixed right-8 top-8 z-50 rounded-md border border-pro-success/25 bg-pro-bg px-4 py-3 text-[12px] font-semibold text-pro-success shadow-lg"
        >
          Celebrated
        </output>
      ) : null}

      <section className="border-b border-pro-border/70 pb-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold text-pro-accent/80">
              Daily briefing
            </p>
            <h1 className="mt-2 text-[28px] font-serif font-medium leading-tight text-pro-text-main">
              Top of mind
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded border px-2.5 py-1 text-[9px] font-semibold ${getHeroTone(model.hero.severity, loading)}`}
            >
              {loading ? 'Refreshing' : model.topOfMind.summary}
            </span>
            {isRecording ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-pro-success">
                <CircleDot className="h-3 w-3" /> Recording
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {topOfMindItems.length ? (
            topOfMindItems.map((item) => (
              <article
                key={item.id}
                data-testid="dashboard-top-of-mind-item"
                className="min-h-[210px] border-t border-pro-border/70 pt-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`rounded border px-2 py-1 text-[9px] font-semibold ${getTopOfMindTone(item)}`}
                  >
                    {item.trustState}
                  </span>
                  <button
                    type="button"
                    onClick={() => runAction(item.action)}
                    className="inline-flex min-h-8 items-center gap-1 text-[11px] font-bold text-pro-accent hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                  >
                    {item.action.label} <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <h2 className="mt-3 text-[16px] font-semibold leading-6 text-pro-text-main">
                  {item.read}
                </h2>
                <p className="mt-2 text-[12px] font-medium leading-5 text-pro-text-muted">
                  {item.whyNow}
                </p>
                {item.consequence ? (
                  <p className="mt-2 text-[11px] font-semibold leading-5 text-pro-text-main/65">
                    {item.consequence}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-pro-text-muted/65">
                  <span>{item.suggestedMove}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.evidenceLabel}</span>
                </div>
              </article>
            ))
          ) : (
            <div className="lg:col-span-3 border-t border-pro-border/70 py-10">
              <p className="text-[16px] font-semibold text-pro-text-main">
                Nothing needs your attention.
              </p>
              <p className="mt-2 max-w-[58ch] text-[13px] font-medium leading-6 text-pro-text-muted">
                Pluto will surface blockers, aging commitments, and meaningful
                changes here when the underlying records support them.
              </p>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-10 pt-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)] lg:gap-12">
        <section aria-labelledby="commitments-title" className="min-w-0">
          <div className="flex items-end justify-between gap-4 border-b border-pro-border/70 pb-3">
            <div>
              <p className="text-[10px] font-semibold text-pro-text-muted/55">
                What you own
              </p>
              <h2
                id="commitments-title"
                className="mt-1 text-[22px] font-serif font-medium text-pro-text-main"
              >
                My commitments
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setAddingCommitment((value) => !value)}
              className="inline-flex min-h-8 items-center gap-2 rounded-md px-3 text-[11px] font-bold text-pro-accent hover:bg-pro-accent/10 hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
            >
              <CalendarPlus className="h-4 w-4" /> Add commitment
            </button>
          </div>

          {addingCommitment ? (
            <form
              onSubmit={submitCommitment}
              className="mt-4 flex flex-col gap-3 border-b border-pro-border/70 pb-4 sm:flex-row"
            >
              <input
                value={commitmentText}
                onChange={(event) => setCommitmentText(event.target.value)}
                placeholder="Commitment"
                aria-label="Commitment"
                className="min-h-10 flex-1 rounded-md border border-pro-border bg-pro-bg px-3 text-[13px] font-medium text-pro-text-main outline-none focus:border-pro-accent"
              />
              <input
                type="date"
                value={commitmentDueDate}
                onChange={(event) => setCommitmentDueDate(event.target.value)}
                aria-label="Optional due date"
                className="min-h-10 rounded-md border border-pro-border bg-pro-bg px-3 text-[13px] font-medium text-pro-text-main outline-none focus:border-pro-accent"
              />
              <button
                type="submit"
                disabled={!commitmentText.trim() || isCreatingCommitment}
                className="inline-flex min-h-10 items-center justify-center rounded-md bg-pro-accent px-4 text-[12px] font-semibold text-white hover:bg-pro-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingCommitment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Add'
                )}
              </button>
            </form>
          ) : null}

          {commitmentItems.length ? (
            <div className="divide-y divide-pro-border/60">
              {commitmentItems.map((item) => {
                const isUpdating =
                  updatingTaskIds.has(item.id) ||
                  Boolean(
                    item.attentionItemId &&
                      updatingTaskIds.has(item.attentionItemId),
                  );
                const primaryLabel = getActionInsightPrimaryLabel(item);
                const primaryAriaLabel = getActionInsightPrimaryAriaLabel(item);
                const reviewActions = getDashboardReviewActions(item, {
                  setSelectedMeetingId,
                  handleReviewCommitment,
                });
                return (
                  <article
                    key={item.id}
                    data-testid="dashboard-commitment-row"
                    aria-busy={isUpdating}
                    className="group py-4"
                  >
                    <div className="flex items-start gap-3">
                      {item.canComplete ? (
                        <button
                          type="button"
                          aria-label={primaryAriaLabel}
                          disabled={isUpdating}
                          onClick={() => handleCompleteTask(item.id)}
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-pro-border text-pro-text-muted transition-colors hover:border-pro-accent hover:text-pro-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-60"
                        >
                          {isUpdating ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-[14px] font-bold leading-5 text-pro-text-main">
                            {item.title}
                          </h3>
                          <span
                            className={`shrink-0 rounded px-2 py-1 text-[9px] font-semibold ${getActionInsightStatusTone(item)}`}
                          >
                            {item.statusLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] font-medium leading-5 text-pro-text-muted">
                          {item.basisLabel}
                        </p>
                        {item.attentionReason &&
                        item.attentionReason !== item.contextLabel ? (
                          <p className="mt-1 text-[11px] font-semibold leading-5 text-pro-urgent/85">
                            {item.attentionReason}
                          </p>
                        ) : null}
                        <div className="mt-2 flex min-h-8 flex-wrap items-center gap-1 text-[10px] font-bold">
                          {item.canComplete ? (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => handleCompleteTask(item.id)}
                              className="min-h-8 rounded-lg px-2 text-pro-accent hover:bg-pro-accent/10 hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50"
                            >
                              {primaryLabel}
                            </button>
                          ) : (
                            <>
                              {!item.sourceMeetingId ? (
                                <details className="min-h-8 rounded-lg px-2 text-pro-accent">
                                  <summary className="cursor-pointer py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent">
                                    Review task
                                  </summary>
                                  <p className="max-w-md pb-2 font-medium leading-5 text-pro-text-muted">
                                    No source meeting is available. Review the
                                    wording above, then confirm it or mark it
                                    not a task.
                                  </p>
                                </details>
                              ) : null}
                              {reviewActions.map((action) => (
                                <button
                                  key={action.label}
                                  type="button"
                                  aria-label={action.ariaLabel}
                                  disabled={isUpdating}
                                  onClick={action.onClick}
                                  className="min-h-8 rounded-lg px-2 text-pro-accent hover:bg-pro-accent/10 hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-50"
                                >
                                  {action.label}
                                </button>
                              ))}
                            </>
                          )}
                          {item.canComplete &&
                          item.attentionItemId &&
                          item.dismissLabel ? (
                            <button
                              type="button"
                              aria-label={`${item.dismissLabel}: ${item.title}`}
                              disabled={isUpdating}
                              onClick={() =>
                                handleUpdateAttentionStatus(
                                  item.attentionItemId!,
                                  item.dismissLabel === 'Reopen'
                                    ? 'active'
                                    : 'dismissed',
                                )
                              }
                              className="min-h-8 rounded-lg px-2 text-pro-text-main/60 hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50"
                            >
                              {item.dismissLabel}
                            </button>
                          ) : null}
                          {item.canComplete &&
                          item.attentionItemId &&
                          item.snoozeLabel ? (
                            <button
                              type="button"
                              aria-label={`${item.snoozeLabel}: ${item.title}`}
                              disabled={isUpdating}
                              onClick={() =>
                                handleUpdateAttentionStatus(
                                  item.attentionItemId!,
                                  item.snoozeLabel === 'Reopen'
                                    ? 'active'
                                    : 'snoozed',
                                )
                              }
                              className="min-h-8 rounded-lg px-2 text-pro-text-main/60 hover:bg-pro-warning/10 hover:text-pro-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50"
                            >
                              {item.snoozeLabel}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="py-7">
              <p className="text-[14px] font-bold text-pro-text-main">
                No confirmed commitments need attention.
              </p>
              <p className="mt-1 text-[12px] font-medium text-pro-text-muted">
                Add one here or let Pluto surface user-owned commitments from
                meetings.
              </p>
            </div>
          )}
          {actionError ? (
            <p
              role="alert"
              className="mt-2 text-[12px] font-semibold text-pro-urgent"
            >
              {actionError}
            </p>
          ) : null}
          {hiddenCommitmentCount > 0 ? (
            <button
              type="button"
              onClick={() => setActiveTab('projects')}
              className="mt-2 inline-flex min-h-8 items-center gap-1 text-[11px] font-bold text-pro-text-muted hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
            >
              Review {hiddenCommitmentCount} more{' '}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {model.commitments.needsConfirmation.length ? (
            <details className="mt-4 border-t border-pro-border/70 pt-4">
              <summary className="cursor-pointer text-[11px] font-bold text-pro-text-muted hover:text-pro-text-main">
                Needs confirmation ({model.commitments.needsConfirmation.length}
                )
              </summary>
              <div className="mt-3 space-y-2">
                {model.commitments.needsConfirmation.map((item) => (
                  <div key={item.id} className="text-[12px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-pro-text-muted">
                        {item.title}
                      </span>
                      <span className="rounded bg-pro-warning/10 px-2 py-1 text-[9px] font-semibold text-pro-warning">
                        {item.statusLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] font-medium text-pro-text-muted/70">
                      {item.basisLabel}
                    </p>
                    {!item.sourceMeetingId ? (
                      <details className="mt-2 min-h-8 text-pro-accent">
                        <summary className="cursor-pointer py-2 text-[11px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent">
                          Review task
                        </summary>
                        <p className="max-w-md pb-2 text-[11px] font-medium leading-5 text-pro-text-muted">
                          No source meeting is available. Review the wording
                          above, then confirm it or mark it not a task.
                        </p>
                      </details>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {getDashboardReviewActions(item, {
                        setSelectedMeetingId,
                        handleReviewCommitment,
                      }).map((action) => (
                        <button
                          key={action.label}
                          type="button"
                          aria-label={action.ariaLabel}
                          onClick={action.onClick}
                          className="min-h-8 rounded-md px-2 text-[11px] font-bold text-pro-accent hover:bg-pro-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </section>

        <aside className="min-w-0">
          <section aria-labelledby="recent-win-title">
            <div className="border-b border-pro-border/70 pb-3">
              <p className="text-[10px] font-semibold text-pro-text-muted/55">
                Evidence-backed
              </p>
              <h2
                id="recent-win-title"
                className="mt-1 text-[22px] font-serif font-medium text-pro-text-main"
              >
                Recent win
              </h2>
            </div>
            {recentWin.state === 'populated' ? (
              <div className="border-t border-pro-border/70 pt-4">
                <h3 className="text-[16px] font-semibold leading-6 text-pro-text-main">
                  {recentWin.title}
                </h3>
                <p className="mt-2 text-[12px] font-medium leading-5 text-pro-text-muted">
                  {recentWin.whyItCounts}
                </p>
                <p className="mt-3 text-[10px] font-semibold text-pro-text-muted/65">
                  Source: {recentWin.sourceLabel}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedMeetingId(recentWin.meetingId)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-pro-accent hover:bg-pro-accent/10 hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                  >
                    Open moment <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={startCelebration}
                    className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-pro-text-muted hover:bg-pro-success/10 hover:text-pro-success focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                  >
                    <PartyPopper className="h-3.5 w-3.5" /> Celebrate
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-pro-border/70 py-7">
                <p className="text-[14px] font-bold text-pro-text-main">
                  {recentWin.title}
                </p>
                <p className="mt-1 text-[12px] font-medium leading-5 text-pro-text-muted">
                  {recentWin.detail}
                </p>
              </div>
            )}
          </section>

          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-pro-border/70 pt-4">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className="inline-flex min-h-8 items-center gap-2 rounded-md px-3 text-[12px] font-bold text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
            >
              <Sparkles className="h-4 w-4" /> Ask Pluto
            </button>
            {latestMeeting.state === 'populated' ? (
              <button
                type="button"
                onClick={() => setSelectedMeetingId(latestMeeting.meetingId)}
                className="inline-flex min-h-8 items-center gap-1 rounded-md px-3 text-[12px] font-bold text-pro-text-muted hover:bg-pro-surface hover:text-pro-text-main"
              >
                Latest meeting · {formatMeetingDate(latestMeeting.occurredAt)}{' '}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {model.knowledgeDocuments.state === 'populated' ? (
              <button
                type="button"
                onClick={() => setActiveTab('wiki')}
                className="inline-flex min-h-8 items-center gap-1 rounded-md px-3 text-[12px] font-bold text-pro-text-muted hover:bg-pro-surface hover:text-pro-text-main"
              >
                Open knowledge <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
};
