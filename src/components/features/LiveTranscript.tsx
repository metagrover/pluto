import { ArrowDown } from 'lucide-react';
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  LiveConversationDraft,
  LiveConversationSnapshot,
  LiveConversationTimelineItem,
} from '../../services/liveTranscription/liveConversationProjection';
import { buildLiveConversationTimeline } from '../../services/liveTranscription/liveConversationProjection';
import {
  type LiveSpeakerIdentityHint,
  type LiveSpeakerIdentitySnapshot,
  liveSpeakerHintForRange,
} from '../../services/liveTranscription/liveSpeakerIdentityContract';
import {
  type LiveTranscriptTurn,
  buildLiveTranscriptTurns,
} from './liveTranscriptPresentation';
import type {
  LiveTranscriptIntegrity,
  LiveTranscriptSegment,
} from './recordingWorkspaceModel';

const LIVE_EDGE_TOLERANCE_PX = 48;

const speakerLabel = (turn: LiveTranscriptTurn): string => {
  if (turn.source === 'mic' || turn.speaker === 'Me') return 'Mic';
  if (turn.source === 'system' || turn.speaker === 'Them') return 'Call';
  return turn.speaker;
};

const SpeakerIdentityControls = ({
  hint,
  fallbackLabel,
  onAction,
}: {
  hint: LiveSpeakerIdentityHint;
  fallbackLabel: string;
  onAction?: (
    suggestionId: string,
    action: 'confirm' | 'reject' | 'restore',
  ) => void;
}) => {
  if (!onAction) {
    return (
      <strong>
        {hint.state === 'rejected' || hint.state === 'revoked'
          ? fallbackLabel
          : hint.displayLabel}
      </strong>
    );
  }
  return (
    <span className="live-speaker-identity">
      <strong>
        {hint.state === 'rejected' ? fallbackLabel : hint.displayLabel}
      </strong>
      {hint.state === 'suggested' ? (
        <span className="live-speaker-identity__actions">
          <button
            type="button"
            onClick={() => onAction(hint.suggestionId, 'confirm')}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => onAction(hint.suggestionId, 'reject')}
          >
            Not this person
          </button>
        </span>
      ) : hint.state === 'confirmed' || hint.state === 'rejected' ? (
        <button
          type="button"
          className="live-speaker-identity__undo"
          onClick={() => onAction(hint.suggestionId, 'restore')}
        >
          Undo
        </button>
      ) : null}
    </span>
  );
};

const TranscriptTurn = memo(
  ({
    turn,
    speakerIdentity,
    onSpeakerIdentityAction,
  }: {
    turn: LiveTranscriptTurn;
    speakerIdentity?: LiveSpeakerIdentitySnapshot | null;
    onSpeakerIdentityAction?: (
      suggestionId: string,
      action: 'confirm' | 'reject' | 'restore',
    ) => void;
  }) => {
    const startedAt = new Date(turn.timestampMs).toISOString();
    const isLive = turn.segments.some((segment) => !segment.confirmed);
    const endMs =
      turn.segments.at(-1)?.endTimestampMs ?? turn.segments.at(-1)?.timestampMs;
    const hint =
      turn.source === 'system' && endMs !== undefined
        ? liveSpeakerHintForRange(speakerIdentity, turn.timestampMs, endMs)
        : null;
    return (
      <article className="transcript-turn">
        <div className="transcript-speaker">
          {hint ? (
            <SpeakerIdentityControls
              hint={hint}
              fallbackLabel={speakerLabel(turn)}
              onAction={onSpeakerIdentityAction}
            />
          ) : (
            <strong>{speakerLabel(turn)}</strong>
          )}
          <time dateTime={startedAt}>
            {isLive ? 'Live' : startedAt.slice(14, 19)}
          </time>
        </div>
        <div className="transcript-turn__content">
          {turn.paragraphs.map((paragraph) => (
            <p key={paragraph.id}>
              {paragraph.parts.map((part, index) => (
                <Fragment key={part.id}>
                  {index > 0 && ' '}
                  <span
                    className={
                      part.confirmed
                        ? 'transcript-paragraph-part'
                        : 'transcript-paragraph-part transcript-paragraph-part--tentative'
                    }
                  >
                    {part.text}
                  </span>
                </Fragment>
              ))}
            </p>
          ))}
        </div>
      </article>
    );
  },
);

const sourceLabel = (source: 'mic' | 'system'): string =>
  source === 'mic' ? 'Mic' : 'Call';

const ConversationTimelineTurn = memo(
  ({
    item,
    speakerIdentity,
    onSpeakerIdentityAction,
  }: {
    item: LiveConversationTimelineItem;
    speakerIdentity?: LiveSpeakerIdentitySnapshot | null;
    onSpeakerIdentityAction?: (
      suggestionId: string,
      action: 'confirm' | 'reject' | 'restore',
    ) => void;
  }) => {
    const first = item.kind === 'committed' ? item.row : item.part;
    const startedAt = new Date(first.timestampMs).toISOString();
    const draft = item.kind === 'draft';
    const hint =
      !draft && first.source === 'system'
        ? liveSpeakerHintForRange(
            speakerIdentity,
            first.timestampMs,
            first.endTimestampMs,
          )
        : null;
    const paragraphs =
      item.kind === 'committed'
        ? [
            {
              id: item.row.parts[0]?.id ?? item.row.id,
              rowId: item.row.id,
              text: item.row.text,
              tentative: false,
            },
          ]
        : [
            {
              id: item.part.id,
              rowId: undefined,
              text: item.part.text,
              tentative: true,
            },
          ];
    return (
      <article
        className={
          draft
            ? 'transcript-turn live-conversation-draft'
            : `transcript-turn live-conversation-row${
                item.continuesPrevious
                  ? ' live-conversation-row--continuation'
                  : ''
              }${item.continuesNext ? ' live-conversation-row--continues' : ''}`
        }
        {...(draft
          ? {
              'aria-label': 'Listening now',
              'data-conversation-draft': item.part.id,
            }
          : {})}
      >
        <div className="transcript-speaker">
          {hint ? (
            <SpeakerIdentityControls
              hint={hint}
              fallbackLabel={sourceLabel(first.source)}
              onAction={onSpeakerIdentityAction}
            />
          ) : (
            <strong>{sourceLabel(first.source)}</strong>
          )}
          <time dateTime={startedAt}>
            {draft ? 'Live' : startedAt.slice(14, 19)}
          </time>
        </div>
        <div className="transcript-turn__content">
          {paragraphs.map((paragraph) => (
            <p
              key={paragraph.id}
              className={
                paragraph.tentative
                  ? 'transcript-paragraph-part--tentative'
                  : undefined
              }
              data-conversation-row={paragraph.rowId}
              data-conversation-part={paragraph.id}
            >
              {paragraph.text}
            </p>
          ))}
          {item.kind === 'committed' && item.row.qualifier && (
            <span className="live-conversation-row__qualifier">Updated</span>
          )}
        </div>
      </article>
    );
  },
);

const conversationTimelineKey = (item: LiveConversationTimelineItem): string =>
  item.id;

const ConversationDraftControl = ({
  draft,
  expanded,
  onToggle,
}: {
  draft: LiveConversationDraft;
  expanded: boolean;
  onToggle(): void;
}) => {
  if (!draft.truncated) return null;
  return (
    <aside
      className="live-conversation-draft__control"
      aria-label="Live wording"
    >
      <div className="live-conversation-draft__heading">
        <strong>Long live passage</strong>
        <button type="button" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? 'Show less' : 'Show all'}
        </button>
      </div>
    </aside>
  );
};

export const LiveTranscript = ({
  segments,
  interimText,
  integrity = 'healthy',
  conversation = null,
  onOpenSettings,
  forceShowWarning = false,
  speakerIdentity = null,
  onSpeakerIdentityAction,
}: {
  segments: LiveTranscriptSegment[];
  interimText: string;
  integrity?: LiveTranscriptIntegrity;
  conversation?: LiveConversationSnapshot | null;
  onOpenSettings?: (
    tab?: 'personal' | 'meetings' | 'intelligence' | 'advanced',
  ) => void;
  forceShowWarning?: boolean;
  speakerIdentity?: LiveSpeakerIdentitySnapshot | null;
  onSpeakerIdentityAction?: (
    suggestionId: string,
    action: 'confirm' | 'reject' | 'restore',
  ) => void;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingLiveRef = useRef(true);
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const turns = useMemo(() => buildLiveTranscriptTurns(segments), [segments]);
  const visibleSegments = turns.flatMap((turn) => turn.segments);
  const showingConversation = conversation !== null;
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null);
  const draftExpanded = conversation?.draft?.id === expandedDraftId;
  useEffect(() => {
    if (!conversation?.draft) setExpandedDraftId(null);
  }, [conversation?.draft]);
  useEffect(() => {
    setExpandedDraftId(null);
  }, [conversation?.generation]);
  const conversationTimeline = useMemo(
    () =>
      buildLiveConversationTimeline(
        conversation?.rows ?? [],
        draftExpanded
          ? (conversation?.draft?.parts ?? [])
          : (conversation?.draft?.collapsedParts ?? []),
      ),
    [conversation?.draft, conversation?.rows, draftExpanded],
  );
  const visibleCount = showingConversation
    ? conversation.rows.filter((row) => row.display === 'speech').length
    : visibleSegments.length;
  const [announcement, setAnnouncement] = useState('');
  const announcedMetricsRef = useRef({ corrections: 0, restorations: 0 });

  useEffect(() => {
    announcedMetricsRef.current = { corrections: 0, restorations: 0 };
    setAnnouncement('');
  }, [conversation?.generation]);

  useEffect(() => {
    if (!conversation) return;
    const previous = announcedMetricsRef.current;
    if (conversation.metrics.restorations > previous.restorations)
      setAnnouncement('Transcript wording restored');
    else if (conversation.metrics.corrections > previous.corrections)
      setAnnouncement('Transcript updated');
    announcedMetricsRef.current = conversation.metrics;
  }, [conversation]);

  const updateFollowingLive = (following: boolean) => {
    followingLiveRef.current = following;
    setIsFollowingLive(following);
  };

  const returnToLive = () => {
    updateFollowingLive(true);
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !followingLiveRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [conversation, interimText, segments]);

  const showWarning =
    forceShowWarning ||
    conversation?.status === 'degraded' ||
    conversation?.status === 'unavailable';

  return (
    <section
      className="live-transcript"
      aria-labelledby="live-transcript-title"
      data-live-transcript
    >
      <div
        className="live-transcript-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          const distanceFromLiveEdge =
            element.scrollHeight - element.scrollTop - element.clientHeight;
          updateFollowingLive(distanceFromLiveEdge <= LIVE_EDGE_TOLERANCE_PX);
        }}
      >
        <div className="live-transcript-heading">
          <div>
            <p className="workspace-eyebrow">Conversation</p>
            <h1 id="live-transcript-title">Live transcript</h1>
          </div>
          <span>
            {visibleCount === 0 && !conversation?.draft
              ? 'Listening'
              : !isFollowingLive
                ? 'Reviewing earlier'
                : integrity === 'lagging'
                  ? 'Falling behind'
                  : conversation?.draft ||
                      visibleSegments.some((segment) => !segment.confirmed)
                    ? 'Refining'
                    : 'Caught up'}
          </span>
        </div>
        <div className="live-transcript-body">
          {showingConversation ? (
            <>
              {conversation.rows.length === 0 && !conversation.draft && (
                <div className="transcript-waiting">
                  <p>Pluto is listening.</p>
                  <span>
                    The conversation will appear here as speech is recognized.
                  </span>
                </div>
              )}
              {conversationTimeline.map((item) => (
                <ConversationTimelineTurn
                  key={conversationTimelineKey(item)}
                  item={item}
                  speakerIdentity={speakerIdentity}
                  onSpeakerIdentityAction={onSpeakerIdentityAction}
                />
              ))}
              {conversation.draft && (
                <ConversationDraftControl
                  draft={conversation.draft}
                  expanded={draftExpanded}
                  onToggle={() =>
                    setExpandedDraftId((current) =>
                      current === conversation.draft?.id
                        ? null
                        : (conversation.draft?.id ?? null),
                    )
                  }
                />
              )}
            </>
          ) : visibleSegments.length === 0 && !interimText ? (
            <div className="transcript-waiting">
              <p>Pluto is listening.</p>
              <span>
                The conversation will appear here as speech is recognized.
              </span>
            </div>
          ) : (
            turns.map((turn) => (
              <TranscriptTurn
                key={turn.id}
                turn={turn}
                speakerIdentity={speakerIdentity}
                onSpeakerIdentityAction={onSpeakerIdentityAction}
              />
            ))
          )}
          {speakerIdentity?.hints.some((hint) => hint.state === 'rejected') && (
            <aside
              className="live-speaker-identity-dismissed"
              aria-label="Dismissed speaker suggestion"
            >
              Suggestion dismissed.
              {speakerIdentity.hints
                .filter((hint) => hint.state === 'rejected')
                .map((hint) => (
                  <button
                    key={hint.suggestionId}
                    type="button"
                    onClick={() =>
                      onSpeakerIdentityAction?.(hint.suggestionId, 'restore')
                    }
                  >
                    Undo
                  </button>
                ))}
            </aside>
          )}
          {!showingConversation && interimText && (
            <p className="transcript-interim" aria-hidden="true">
              {interimText}
            </p>
          )}
          {showWarning && (
            <aside
              className="live-conversation-warning"
              aria-label="Live transcript status"
            >
              <div className="live-conversation-warning__header">
                <span
                  className="live-conversation-warning__dot"
                  aria-hidden="true"
                />
                <span>Audio is recording safely · Live wording paused</span>
              </div>
              <div className="live-conversation-warning__body">
                <p>
                  To keep live transcript and questions active with local AI
                  models, turn off Generate notes during meetings in Settings →
                  Meetings.
                </p>
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={() => onOpenSettings('meetings')}
                    className="live-conversation-warning__action"
                  >
                    Open Settings →
                  </button>
                )}
              </div>
            </aside>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </div>
      </div>
      {!isFollowingLive && (
        <div className="live-transcript-follow-control">
          <button type="button" onClick={returnToLive}>
            <ArrowDown aria-hidden="true" size={14} strokeWidth={2} />
            Return to live
          </button>
        </div>
      )}
    </section>
  );
};
