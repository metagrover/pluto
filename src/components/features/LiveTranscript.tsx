import { ArrowDown } from 'lucide-react';
import {
  Fragment,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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

export const LiveTranscript = ({
  segments,
  interimText,
  integrity = 'healthy',
}: {
  segments: LiveTranscriptSegment[];
  interimText: string;
  integrity?: LiveTranscriptIntegrity;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingLiveRef = useRef(true);
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const turns = useMemo(() => buildLiveTranscriptTurns(segments), [segments]);
  const visibleSegments = turns.flatMap((turn) => turn.segments);

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
  }, [interimText, segments]);

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
            {visibleSegments.length === 0
              ? 'Listening'
              : !isFollowingLive
                ? 'Reviewing earlier'
                : integrity === 'lagging'
                  ? 'Falling behind'
                  : visibleSegments.some((segment) => !segment.confirmed)
                    ? 'Refining'
                    : 'Caught up'}
          </span>
        </div>
        <div className="live-transcript-body">
          {visibleSegments.length === 0 && !interimText ? (
            <div className="transcript-waiting">
              <p>Pluto is listening.</p>
              <span>
                The conversation will appear here as speech is recognized.
              </span>
            </div>
          ) : (
            turns.map((turn) => <TranscriptTurn key={turn.id} turn={turn} />)
          )}
          {interimText && (
            <p className="transcript-interim" aria-hidden="true">
              {interimText}
            </p>
          )}
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
