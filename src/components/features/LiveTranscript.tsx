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
  LiveConversationRow,
  LiveConversationSnapshot,
} from '../../services/liveTranscription/liveConversationProjection';
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
  if (turn.source === 'mic' || turn.speaker === 'Me') return 'You';
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
  source === 'mic' ? 'You' : 'Call';

const ConversationRow = memo(({ row }: { row: LiveConversationRow }) => {
  const startedAt = new Date(row.timestampMs).toISOString();
  return (
    <article
      className={`transcript-turn live-conversation-row${
        row.display === 'duplicate_removed'
          ? ' live-conversation-row--duplicate'
          : ''
      }`}
      data-conversation-row={row.id}
    >
      <div className="transcript-speaker">
        <strong>{sourceLabel(row.source)}</strong>
        <time dateTime={startedAt}>{startedAt.slice(14, 19)}</time>
      </div>
      <div className="transcript-turn__content">
        {row.display === 'duplicate_removed' ? (
          <p className="live-conversation-row__placeholder">
            Duplicate removed
          </p>
        ) : (
          <p>{row.text}</p>
        )}
        {row.qualifier && (
          <span className="live-conversation-row__qualifier">
            {row.qualifier === 'updated' ? 'Updated' : 'Earlier speech'}
          </span>
        )}
      </div>
    </article>
  );
});

const ConversationDraft = ({ draft }: { draft: LiveConversationDraft }) => {
  const [expanded, setExpanded] = useState(false);
  const parts = expanded ? draft.parts : draft.collapsedParts;
  return (
    <aside className="live-conversation-draft" aria-label="Listening now">
      <div className="live-conversation-draft__heading">
        <strong>Listening now</strong>
        {draft.truncated && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Show less' : 'Show all'}
          </button>
        )}
      </div>
      <div className="live-conversation-draft__parts">
        {parts.map((part) => (
          <p key={part.id}>
            <span>{sourceLabel(part.source)}</span>
            {part.text}
          </p>
        ))}
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
  const visibleCount = showingConversation
    ? conversation.rows.length
    : visibleSegments.length;
  const [announcement, setAnnouncement] = useState('');
  const announcedMetricsRef = useRef({ corrections: 0, restorations: 0 });

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
              {conversation.rows.map((row) => (
                <ConversationRow key={row.id} row={row} />
              ))}
              {conversation.draft && (
                <ConversationDraft
                  key={`${conversation.generation}:${conversation.draft.id}`}
                  draft={conversation.draft}
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
