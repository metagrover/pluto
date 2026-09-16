import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  CircleDot,
  GripVertical,
  Loader2,
  MoreHorizontal,
  PartyPopper,
  Plus,
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
  CalendarDescriptor,
  CalendarEvent,
  CalendarIntegrationSnapshot,
} from '../../../electron/calendar/types';

import relaxedEmptyIllustration from '../../assets/illustrations/dashboard-relaxed-empty.webp';

import { UpcomingMeetings } from './UpcomingMeetings';
import type {
  DashboardActionInsightItem,
  DashboardHomeModel,
} from './dashboardModel';
import { getDashboardDateKey } from './dashboardModel';

interface DashboardProps {
  model: DashboardHomeModel;
  date?: Date;
  loading: boolean;
  isRecording: boolean;
  setSelectedMeetingId: (id: string | number | null) => void;
  setActiveTab: (
    tab: 'hub' | 'people' | 'projects' | 'meetings' | 'chat',
  ) => void;
  setAskPlutoVisible?: (visible: boolean) => void;
  updatingTaskIds: Set<string>;
  actionError: string | null;
  dashboardError?: Error | null;
  onRetryDashboard?: () => Promise<void>;
  handleCompleteTask: (id: string) => Promise<void>;
  handleReviewCommitment?: (
    id: string,
    state: 'confirmed' | 'rejected',
  ) => Promise<void>;
  handleCreateCommitment?: (
    text: string,
    dueDate: string | null,
  ) => Promise<undefined | { id: string }>;
  handleSetDailyCommitments?: (
    orderedIds: string[],
    previousIds: string[],
    dateKey: string,
  ) => Promise<void>;
  handleUpdateAttentionStatus?: (
    attentionItemId: string,
    nextStatus: 'active' | 'dismissed' | 'snoozed',
  ) => Promise<void>;
  calendarSnapshot?: CalendarIntegrationSnapshot | null;
  calendarEvents?: CalendarEvent[];
  calendarLoading?: boolean;
  onCalendarConnect?: () => Promise<void>;
  onCalendarSelect?: (calendar: CalendarDescriptor) => Promise<void>;
  onCalendarSelectCalendars?: (
    calendars: CalendarDescriptor[],
  ) => Promise<void>;
  onCalendarRefresh?: () => Promise<void>;
  onCalendarOpenSettings?: () => void;
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

const getActionInsightPrimaryAriaLabel = (item: DashboardActionInsightItem) =>
  item.attentionLabel === 'Blocker' && item.attentionStatus === 'active'
    ? `Resolve blocker: ${item.title}`
    : `Mark ${item.title} complete`;

interface DashboardReviewAction {
  label: 'Open full meeting' | 'Add to commitments' | 'Dismiss';
  kind: 'source' | 'primary' | 'secondary';
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
          label: 'Open full meeting' as const,
          kind: 'source' as const,
          ariaLabel: `Open full meeting for ${item.title}`,
          onClick: () => handlers.setSelectedMeetingId(item.sourceMeetingId),
        },
      ]
    : []),
  {
    label: 'Add to commitments',
    kind: 'primary',
    ariaLabel: `Add ${item.title} to commitments`,
    onClick: () => handlers.handleReviewCommitment(item.id, 'confirmed'),
  },
  {
    label: 'Dismiss',
    kind: 'secondary',
    ariaLabel: `Dismiss suggestion: ${item.title}`,
    onClick: () => handlers.handleReviewCommitment(item.id, 'rejected'),
  },
];

const DashboardSuggestionReview = ({
  item,
  isUpdating,
  expanded,
  compact = false,
  onToggle,
  onDecisionComplete,
  setSelectedMeetingId,
  handleReviewCommitment,
}: {
  item: DashboardActionInsightItem;
  isUpdating: boolean;
  expanded: boolean;
  compact?: boolean;
  onToggle: () => void;
  onDecisionComplete: (state: 'confirmed' | 'rejected') => void;
  setSelectedMeetingId: (id: string | number | null) => void;
  handleReviewCommitment: (
    id: string,
    state: 'confirmed' | 'rejected',
  ) => Promise<void>;
}) => {
  const actions = getDashboardReviewActions(item, {
    setSelectedMeetingId,
    handleReviewCommitment,
  });
  const sourceAction = actions.find((action) => action.kind === 'source');
  const decisionActions = actions.filter((action) => action.kind !== 'source');
  const panelId = `dashboard-suggestion-panel-${item.id}`;
  const sourceExcerpt =
    item.sourceSynthesis?.topicSummary ??
    item.sourceSynthesis?.overview ??
    item.sourceSynthesis?.evidence ??
    null;
  const basisLabel = item.basisLabel.replace(/^Possible follow-up · /, '');

  return (
    <article
      data-testid="dashboard-suggestion-review"
      aria-busy={isUpdating}
      className={`-mx-3 rounded-lg px-3 transition-colors ${expanded ? 'bg-pro-surface/45' : 'hover:bg-pro-surface/25'}`}
    >
      <button
        type="button"
        aria-label={`Review suggestion: ${item.title}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className={`group flex w-full items-start gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent ${compact ? 'py-2' : 'py-4'}`}
      >
        {compact ? (
          <span className="min-w-0 flex-1 text-[11px] font-semibold leading-5 text-pro-accent">
            Review details
          </span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold leading-5 text-pro-text-main">
              {item.title}
            </span>
            <span className="mt-1 block text-[11px] font-medium leading-5 text-pro-text-muted">
              {basisLabel}
            </span>
          </span>
        )}
        <ChevronRight
          className={`mt-1 h-4 w-4 shrink-0 text-pro-text-muted/65 transition-transform duration-200 ease-out group-hover:text-pro-text-main motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div
          id={panelId}
          className="animate-in fade-in pb-4 duration-150 motion-reduce:animate-none"
        >
          {sourceAction ? (
            <button
              type="button"
              aria-label={`Open source meeting for ${item.title}`}
              disabled={isUpdating}
              onClick={sourceAction.onClick}
              className="line-clamp-1 w-full text-left text-[11px] font-medium leading-5 text-pro-text-muted/85 transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-50"
            >
              {sourceExcerpt ?? 'Source context is available in the meeting.'}
            </button>
          ) : (
            <p className="text-[11px] font-medium leading-5 text-pro-text-muted/80">
              No source context is available for this suggestion.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {decisionActions.map((action) => (
              <button
                key={action.label}
                type="button"
                aria-label={action.ariaLabel}
                disabled={isUpdating}
                onClick={async () => {
                  await action.onClick();
                  onDecisionComplete(
                    action.kind === 'primary' ? 'confirmed' : 'rejected',
                  );
                }}
                className={
                  action.kind === 'primary'
                    ? 'inline-flex min-h-8 items-center rounded-md bg-pro-accent px-3 text-[11px] font-semibold text-white transition-colors hover:bg-pro-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-50'
                    : 'inline-flex min-h-8 items-center rounded-md px-2 text-[11px] font-semibold text-pro-text-muted transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-50'
                }
              >
                {action.kind === 'primary' ? 'Add commitment' : action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
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

export const formatDashboardDate = (date: Date): string =>
  date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

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
  date = new Date(),
  loading,
  isRecording,
  setSelectedMeetingId,
  updatingTaskIds,
  actionError,
  dashboardError = null,
  onRetryDashboard = async () => {},
  handleCompleteTask,
  handleReviewCommitment = async () => {},
  handleCreateCommitment = async () => undefined,
  handleSetDailyCommitments = async () => {},
  handleUpdateAttentionStatus = async () => {},
  calendarSnapshot = null,
  calendarEvents = [],
  calendarLoading = false,
  onCalendarConnect = async () => {},
  onCalendarSelect = async () => {},
  onCalendarSelectCalendars = async () => {},
  onCalendarRefresh = async () => {},
  onCalendarOpenSettings = () => {},
}: DashboardProps) => {
  const [addingCommitment, setAddingCommitment] = useState(false);
  const [commitmentText, setCommitmentText] = useState('');
  const [commitmentDueDate, setCommitmentDueDate] = useState('');
  const [isCreatingCommitment, setIsCreatingCommitment] = useState(false);
  const [reviewingSuggestionId, setReviewingSuggestionId] = useState<
    string | null
  >(null);
  const [recentlyAddedCommitmentId, setRecentlyAddedCommitmentId] = useState<
    string | null
  >(null);
  const [openCommitmentMenuId, setOpenCommitmentMenuId] = useState<
    string | null
  >(null);
  const openCommitmentMenuRef = useRef<HTMLDivElement>(null);
  const [celebration, setCelebration] = useState<
    'idle' | 'confetti' | 'reduced'
  >('idle');
  const initialCommitmentIds =
    model.commitments.state === 'populated'
      ? model.commitments.items.map((item) => item.id)
      : [];
  const [orderedCommitmentIds, setOrderedCommitmentIds] =
    useState<string[]>(initialCommitmentIds);
  const [draggedCommitmentId, setDraggedCommitmentId] = useState<string | null>(
    null,
  );
  const [isSavingDailyOrder, setIsSavingDailyOrder] = useState(false);
  const isSavingDailyOrderRef = useRef(false);

  useEffect(() => {
    if (celebration === 'idle') return;
    const timeout = window.setTimeout(() => setCelebration('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [celebration]);

  useEffect(() => {
    if (!recentlyAddedCommitmentId) return;
    const timeout = window.setTimeout(
      () => setRecentlyAddedCommitmentId(null),
      2400,
    );
    return () => window.clearTimeout(timeout);
  }, [recentlyAddedCommitmentId]);

  useEffect(() => {
    if (!openCommitmentMenuId) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !openCommitmentMenuRef.current?.contains(event.target)
      ) {
        setOpenCommitmentMenuId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenCommitmentMenuId(null);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openCommitmentMenuId]);

  const modelCommitmentIds =
    model.commitments.state === 'populated'
      ? model.commitments.items.map((item) => item.id).join('|')
      : '';
  useEffect(() => {
    setOrderedCommitmentIds(modelCommitmentIds.split('|').filter(Boolean));
  }, [modelCommitmentIds]);

  const finishSuggestionReview = (
    itemId: string,
    state: 'confirmed' | 'rejected',
  ) => {
    setReviewingSuggestionId(null);
    if (state === 'confirmed') setRecentlyAddedCommitmentId(itemId);
  };

  const submitCommitment = async (event: FormEvent) => {
    event.preventDefault();
    const text = commitmentText.trim();
    if (!text || isCreatingCommitment) return;

    setIsCreatingCommitment(true);
    try {
      const created = await handleCreateCommitment(
        text,
        commitmentDueDate || null,
      );
      setCommitmentText('');
      setCommitmentDueDate('');
      setAddingCommitment(false);
      if (created?.id) {
        const nextIds = [created.id, ...orderedCommitmentIds].slice(0, 3);
        try {
          await handleSetDailyCommitments(
            nextIds,
            orderedCommitmentIds,
            getDashboardDateKey(date),
          );
          setOrderedCommitmentIds(nextIds);
        } catch {
          // The commitment is already saved; App surfaces the ordering error.
        }
      }
    } finally {
      setIsCreatingCommitment(false);
    }
  };

  const startCelebration = () => {
    setCelebration(shouldUseReducedDashboardMotion() ? 'reduced' : 'confetti');
  };

  const recentWin = model.recentWin;
  const allCommitmentItems =
    model.commitments.state === 'populated'
      ? [...model.commitments.items, ...model.commitments.backlog]
      : [];
  const commitmentItems = orderedCommitmentIds
    .map((id) => allCommitmentItems.find((item) => item.id === id))
    .filter((item): item is DashboardActionInsightItem => Boolean(item));
  const backlogItems = allCommitmentItems.filter(
    (item) => !orderedCommitmentIds.includes(item.id),
  );
  const confettiPieces = buildDashboardConfettiPieces();

  const saveDailyOrder = async (nextIds: string[]) => {
    if (isSavingDailyOrderRef.current) return;
    isSavingDailyOrderRef.current = true;
    setIsSavingDailyOrder(true);
    const previousIds = orderedCommitmentIds;
    setOrderedCommitmentIds(nextIds);
    try {
      await handleSetDailyCommitments(
        nextIds,
        previousIds,
        getDashboardDateKey(date),
      );
    } catch {
      setOrderedCommitmentIds(previousIds);
    } finally {
      isSavingDailyOrderRef.current = false;
      setIsSavingDailyOrder(false);
    }
  };

  const moveCommitment = (id: string, offset: -1 | 1) => {
    const index = orderedCommitmentIds.indexOf(id);
    const targetIndex = index + offset;
    if (
      index < 0 ||
      targetIndex < 0 ||
      targetIndex >= orderedCommitmentIds.length
    )
      return;
    const nextIds = [...orderedCommitmentIds];
    [nextIds[index], nextIds[targetIndex]] = [
      nextIds[targetIndex],
      nextIds[index],
    ];
    void saveDailyOrder(nextIds);
  };

  const dropCommitment = (targetId: string) => {
    if (!draggedCommitmentId || draggedCommitmentId === targetId) return;
    const nextIds = orderedCommitmentIds.filter(
      (id) => id !== draggedCommitmentId,
    );
    const targetIndex = nextIds.indexOf(targetId);
    nextIds.splice(targetIndex, 0, draggedCommitmentId);
    setDraggedCommitmentId(null);
    void saveDailyOrder(nextIds);
  };

  if (loading) {
    return (
      <main
        data-testid="dashboard-initial-loading"
        aria-busy="true"
        aria-label="Loading daily briefing"
        className="relative mx-auto w-full max-w-[1080px] pb-16"
      >
        <section className="border-b border-pro-border/70 pb-6">
          <div className="h-3 w-24 rounded bg-pro-surface" />
          <div className="mt-3 h-8 w-48 rounded bg-pro-surface" />
          <div className="mt-7 h-20 rounded-xl bg-pro-surface/70 motion-reduce:animate-none" />
        </section>
        <div className="grid gap-8 pt-7 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
          <div className="space-y-3">
            <div className="h-7 w-44 rounded bg-pro-surface" />
            <div className="h-16 rounded-lg bg-pro-surface/70" />
            <div className="h-16 rounded-lg bg-pro-surface/70" />
          </div>
          <div className="h-44 rounded-xl bg-pro-surface/70" />
        </div>
      </main>
    );
  }

  return (
    <main className="relative mx-auto w-full max-w-[1080px] animate-in pb-16">
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

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-pro-border/70 pb-7">
        <div>
          <p className="text-[11px] font-medium tracking-[0.02em] text-pro-accent/80">
            Daily briefing
          </p>
          <h1 className="mt-2 text-[34px] font-serif font-medium leading-tight text-pro-text-main sm:text-[38px]">
            {formatDashboardDate(date)}
          </h1>
        </div>
        {isRecording ? (
          <span className="mb-1 inline-flex items-center gap-1.5 text-[10px] font-semibold text-pro-success">
            <CircleDot className="h-3 w-3" /> Recording
          </span>
        ) : null}
      </header>
      <div className="grid gap-8 pt-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)] lg:gap-12">
        <section
          id="todays-focus"
          aria-labelledby="commitments-title"
          className="min-w-0"
        >
          <div className="flex items-end justify-between gap-4 pb-3">
            <div>
              <p className="text-[10px] font-medium text-pro-text-muted/60">
                Pluto proposes, you decide
              </p>
              <h2
                id="commitments-title"
                className="mt-1 text-[23px] font-serif font-medium text-pro-text-main"
              >
                Today&apos;s focus
              </h2>
            </div>
            <button
              type="button"
              aria-label="Add a commitment"
              title="Add a commitment"
              onClick={() => setAddingCommitment((value) => !value)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-pro-border/70 text-pro-text-muted transition-colors hover:border-pro-border hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
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

          {dashboardError ? (
            <div
              role="alert"
              data-testid="dashboard-commitments-unavailable"
              className="mt-4 rounded-lg border border-pro-border/70 bg-pro-surface/45 px-5 py-6"
            >
              <h3 className="text-[15px] font-medium text-pro-text-main">
                Commitments unavailable
              </h3>
              <p className="mt-1 max-w-[48ch] text-[12px] leading-5 text-pro-text-muted">
                Pluto couldn&apos;t safely refresh your commitments. Your last
                loaded view is preserved when available.
              </p>
              <button
                type="button"
                onClick={() => void onRetryDashboard().catch(() => {})}
                className="mt-3 min-h-9 rounded-md border border-pro-border px-3 text-[11px] font-semibold text-pro-text-main transition-colors hover:bg-pro-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
              >
                Retry
              </button>
            </div>
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
                const primaryAriaLabel = getActionInsightPrimaryAriaLabel(item);
                const showStatus =
                  recentlyAddedCommitmentId === item.id ||
                  item.commitmentState === 'possible' ||
                  item.status !== 'active' ||
                  item.attentionLabel === 'Blocker';
                const hasSecondaryActions = Boolean(
                  item.attentionItemId &&
                    (item.dismissLabel || item.snoozeLabel),
                );
                const dueLabel = item.basisLabel.split(' · ')[0];
                const hasDueDate = dueLabel !== 'No due date';
                const contextLabel =
                  item.sourceMeetingTitle ??
                  (item.contextLabel !== item.attentionReason
                    ? item.contextLabel
                    : null);
                const basisLabel = contextLabel
                  ? `${hasDueDate ? `${dueLabel} · ` : ''}${item.sourceMeetingTitle ? 'From ' : ''}${contextLabel}`
                  : hasDueDate
                    ? dueLabel
                    : '';
                const priorityIndex = orderedCommitmentIds.indexOf(item.id);
                return (
                  <article
                    key={item.id}
                    data-testid="dashboard-commitment-row"
                    aria-busy={isUpdating}
                    draggable={!isUpdating && !isSavingDailyOrder}
                    onDragStart={(event) => {
                      setDraggedCommitmentId(item.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', item.id);
                    }}
                    onDragEnd={() => setDraggedCommitmentId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropCommitment(item.id)}
                    className={`group py-4 transition-opacity ${draggedCommitmentId === item.id ? 'opacity-45' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="flex w-5 shrink-0 cursor-grab items-center justify-center self-center text-pro-text-muted/45 active:cursor-grabbing"
                        title={`Drag ${item.title} to reorder`}
                        aria-hidden="true"
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      {item.canComplete ? (
                        <button
                          type="button"
                          aria-label={primaryAriaLabel}
                          disabled={isUpdating}
                          onClick={() => handleCompleteTask(item.id)}
                          className="group/complete flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full border border-pro-border text-pro-text-muted/55 transition-colors hover:border-pro-accent hover:bg-pro-accent/5 hover:text-pro-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-60"
                        >
                          {isUpdating ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover/complete:opacity-100 group-focus-visible/complete:opacity-100 motion-reduce:transition-none" />
                          )}
                        </button>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-[14px] font-normal leading-5 text-pro-text-main">
                            {item.title}
                          </h3>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
                              <button
                                type="button"
                                aria-label={`Move ${item.title} up`}
                                disabled={
                                  isUpdating ||
                                  isSavingDailyOrder ||
                                  priorityIndex === 0
                                }
                                onClick={() => moveCommitment(item.id, -1)}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-25"
                              >
                                <ArrowUp
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${item.title} down`}
                                disabled={
                                  isUpdating ||
                                  isSavingDailyOrder ||
                                  priorityIndex ===
                                    orderedCommitmentIds.length - 1
                                }
                                onClick={() => moveCommitment(item.id, 1)}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-25"
                              >
                                <ArrowDown
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                            {showStatus ? (
                              <span
                                role={
                                  recentlyAddedCommitmentId === item.id
                                    ? 'status'
                                    : undefined
                                }
                                className={`rounded px-2 py-1 text-[9px] font-semibold ${recentlyAddedCommitmentId === item.id ? 'bg-pro-success/10 text-pro-success' : getActionInsightStatusTone(item)}`}
                              >
                                {recentlyAddedCommitmentId === item.id
                                  ? 'Added'
                                  : item.statusLabel}
                              </span>
                            ) : null}
                            {hasSecondaryActions ? (
                              <div
                                ref={
                                  openCommitmentMenuId === item.id
                                    ? openCommitmentMenuRef
                                    : undefined
                                }
                                className="relative"
                              >
                                <button
                                  type="button"
                                  aria-label={`More actions for ${item.title}`}
                                  aria-haspopup="menu"
                                  aria-expanded={
                                    openCommitmentMenuId === item.id
                                  }
                                  disabled={isUpdating}
                                  onClick={() =>
                                    setOpenCommitmentMenuId((current) =>
                                      current === item.id ? null : item.id,
                                    )
                                  }
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-pro-text-muted/55 transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50"
                                >
                                  <MoreHorizontal
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                </button>
                                {openCommitmentMenuId === item.id ? (
                                  <div
                                    role="menu"
                                    aria-label={`Actions for ${item.title}`}
                                    className="absolute right-0 top-8 z-20 min-w-36 rounded-md border border-pro-border bg-pro-bg p-1 shadow-lg"
                                  >
                                    {item.dismissLabel ? (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        disabled={isUpdating}
                                        onClick={async () => {
                                          await handleUpdateAttentionStatus(
                                            item.attentionItemId!,
                                            item.dismissLabel === 'Reopen'
                                              ? 'active'
                                              : 'dismissed',
                                          );
                                          setOpenCommitmentMenuId(null);
                                        }}
                                        className="flex min-h-9 w-full items-center rounded px-2 text-left text-[11px] font-medium text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-50"
                                      >
                                        {item.dismissLabel}
                                      </button>
                                    ) : null}
                                    {item.snoozeLabel ? (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        disabled={isUpdating}
                                        onClick={async () => {
                                          await handleUpdateAttentionStatus(
                                            item.attentionItemId!,
                                            item.snoozeLabel === 'Reopen'
                                              ? 'active'
                                              : 'snoozed',
                                          );
                                          setOpenCommitmentMenuId(null);
                                        }}
                                        className="flex min-h-9 w-full items-center rounded px-2 text-left text-[11px] font-medium text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-50"
                                      >
                                        {item.snoozeLabel}
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {item.sourceMeetingId && item.canComplete ? (
                          <button
                            type="button"
                            aria-label={`Open source meeting for ${item.title}`}
                            onClick={() =>
                              setSelectedMeetingId(item.sourceMeetingId)
                            }
                            className="mt-1 block max-w-full truncate text-left text-[11px] font-medium leading-5 text-pro-text-muted transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                          >
                            {basisLabel}
                          </button>
                        ) : basisLabel ? (
                          <p className="mt-1 truncate text-[11px] font-medium leading-5 text-pro-text-muted">
                            {basisLabel}
                          </p>
                        ) : null}
                        {item.attentionReason ? (
                          <p className="mt-1 text-[11px] font-semibold leading-5 text-pro-urgent/85">
                            {item.attentionReason}
                          </p>
                        ) : null}
                        {!item.canComplete ? (
                          <div className="mt-2">
                            <DashboardSuggestionReview
                              item={item}
                              isUpdating={isUpdating}
                              compact
                              expanded={reviewingSuggestionId === item.id}
                              onToggle={() =>
                                setReviewingSuggestionId((current) =>
                                  current === item.id ? null : item.id,
                                )
                              }
                              onDecisionComplete={(state) =>
                                finishSuggestionReview(item.id, state)
                              }
                              setSelectedMeetingId={setSelectedMeetingId}
                              handleReviewCommitment={handleReviewCommitment}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : dashboardError ? null : (
            <div
              data-testid="daily-three-empty"
              className="flex min-h-[390px] flex-col items-center justify-center px-6 py-10 text-center"
            >
              <img
                src={relaxedEmptyIllustration}
                alt=""
                aria-hidden="true"
                draggable={false}
                data-testid="daily-three-empty-illustration"
                className="h-auto w-full max-w-[310px] select-none object-contain opacity-95 dark:invert dark:hue-rotate-180 dark:opacity-80"
              />
              <h3 className="mt-6 text-[19px] font-serif font-medium text-pro-text-main">
                Nothing needs your attention
              </h3>
              <p className="mt-2 max-w-[42ch] text-[13px] font-normal leading-6 text-pro-text-muted">
                Your day is open. Add something that matters, or let Pluto
                propose priorities as your commitments take shape.
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
          {backlogItems.length > 0 ? (
            <details className="group/backlog mt-3 border-b border-pro-border/60 pb-3">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-pro-text-muted transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="h-3.5 w-3.5 transition-transform duration-200 ease-out group-open/backlog:rotate-90 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                Remaining commitments · {backlogItems.length}
              </summary>
              <div className="divide-y divide-pro-border/50 pl-5">
                {backlogItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-[13px] font-normal text-pro-text-main/80">
                        {item.title}
                      </span>
                      {item.commitmentState === 'possible' ? (
                        <span className="shrink-0 rounded bg-pro-warning/10 px-1.5 py-0.5 text-[9px] font-semibold text-pro-warning">
                          Needs review
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      aria-label={`Add ${item.title} to today's three`}
                      disabled={isSavingDailyOrder}
                      onClick={() => {
                        const nextIds =
                          orderedCommitmentIds.length < 3
                            ? [...orderedCommitmentIds, item.id]
                            : [...orderedCommitmentIds.slice(0, 2), item.id];
                        void saveDailyOrder(nextIds);
                      }}
                      className="shrink-0 rounded-md px-2 py-1.5 text-[11px] font-medium text-pro-text-muted transition-colors hover:bg-pro-surface hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:cursor-wait disabled:opacity-50"
                    >
                      Prioritize
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </section>

        <aside className="min-w-0 space-y-8">
          <UpcomingMeetings
            snapshot={calendarSnapshot}
            events={calendarEvents}
            loading={calendarLoading}
            onConnect={onCalendarConnect}
            onSelectCalendar={onCalendarSelect}
            onSelectCalendars={onCalendarSelectCalendars}
            onRefreshCalendar={onCalendarRefresh}
            onOpenSettings={onCalendarOpenSettings}
          />
          <section
            aria-labelledby="recent-win-title"
            className="border-t border-pro-border/70 pt-6"
          >
            <p className="text-[10px] font-medium text-pro-text-muted/60">
              {recentWin.state === 'populated' ? 'Evidence-backed' : 'Momentum'}
            </p>
            <h2
              id="recent-win-title"
              className="mt-1 text-[20px] font-serif font-medium text-pro-text-main"
            >
              Recent win
            </h2>
            <div className="mt-4 pt-4">
              {recentWin.state === 'populated' ? (
                <>
                  <h3 className="text-[15px] font-medium leading-6 text-pro-text-main">
                    {recentWin.title}
                  </h3>
                  <p className="mt-2 text-[13px] font-normal leading-[1.55] text-pro-text-muted">
                    {recentWin.whyItCounts}
                  </p>
                  <p className="mt-3 text-[10px] font-medium text-pro-text-muted/65">
                    Source: {recentWin.sourceLabel}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {recentWin.meetingId ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedMeetingId(recentWin.meetingId)
                        }
                        className="inline-flex min-h-8 items-center gap-1 text-[12px] font-semibold text-pro-accent hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                      >
                        Open moment{' '}
                        <ArrowRight
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={startCelebration}
                      className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-pro-text-muted hover:bg-pro-success/10 hover:text-pro-success focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
                    >
                      <PartyPopper className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                      Celebrate
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pro-warning/10 text-pro-warning">
                    <PartyPopper className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-[14px] font-normal leading-5 text-pro-text-muted">
                      {recentWin.title}
                    </h3>
                    <p className="mt-1 text-[12px] font-medium leading-5 text-pro-text-muted">
                      {recentWin.detail}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
};
