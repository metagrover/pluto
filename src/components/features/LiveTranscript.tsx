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

const TranscriptTurn = memo(
  ({
    turn,
  }: {
    turn: LiveTranscriptTurn;
  }) => {
    const startedAt = new Date(turn.timestampMs).toISOString();
    const isLive = turn.segments.some((segment) => !segment.confirmed);
    return (
      <article className="transcript-turn">
        <div className="transcript-speaker">
          <strong>{speakerLabel(turn)}</strong>
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
  ({ item }: { item: LiveConversationTimelineItem }) => {
    const first = item.kind === 'committed' ? item.rows[0] : item.part;
    const startedAt = new Date(first.timestampMs).toISOString();
    const draft = item.kind === 'draft';
    return (
      <article
        className={
          draft
            ? 'transcript-turn live-conversation-draft'
            : 'transcript-turn live-conversation-row'
        }
        {...(draft
          ? {
              'aria-label': 'Listening now',
              'data-conversation-draft': item.part.id,
            }
          : {})}
      >
        <div className="transcript-speaker">
          <strong>{sourceLabel(first.source)}</strong>
          <time dateTime={startedAt}>
            {draft ? 'Live' : startedAt.slice(14, 19)}
          </time>
        </div>
        <div className="transcript-turn__content">
          {item.kind === 'committed' ? (
            item.rows.map((row) => (
              <p key={row.id} data-conversation-row={row.id}>
                {row.text}
              </p>
            ))
          ) : (
            <p className="transcript-paragraph-part--tentative">
              {item.part.text}
            </p>
          )}
          {item.kind === 'committed' &&
            item.rows.some((row) => row.qualifier) && (
              <span className="live-conversation-row__qualifier">Updated</span>
            )}
        </div>
      </article>
    );
  },
);

const conversationTimelineKey = (item: LiveConversationTimelineItem): string =>
  item.kind === 'draft' ? item.part.sourceSegmentId : item.rows[0].id;

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
}: {
  segments: LiveTranscriptSegment[];
  interimText: string;
  integrity?: LiveTranscriptIntegrity;
  conversation?: LiveConversationSnapshot | null;
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
              {(conversation.status === 'degraded' ||
                conversation.status === 'unavailable') && (
                <p className="live-conversation-warning">
                  Live wording may be incomplete. Recording continues safely.
                </p>
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
            turns.map((turn) => <TranscriptTurn key={turn.id} turn={turn} />)
          )}
          {!showingConversation && interimText && (
            <p className="transcript-interim" aria-hidden="true">
              {interimText}
            </p>
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
