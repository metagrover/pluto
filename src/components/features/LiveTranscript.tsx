import { ArrowDown } from 'lucide-react';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  advanceTranscriptRevealText,
  getLiveTranscriptRevealDelay,
  getPendingTranscriptWordCount,
} from '../../utils/liveTranscriptReveal';
import {
  type LiveTranscriptTurn,
  buildLiveTranscriptTurns,
} from './liveTranscriptPresentation';
import type { LiveTranscriptSegment } from './recordingWorkspaceModel';

const LIVE_EDGE_TOLERANCE_PX = 48;

const RevealedTranscriptText = memo(
  ({
    text,
    revealOnMount,
    prefersReducedMotion,
    onRevealProgress,
  }: {
    text: string;
    revealOnMount: boolean;
    prefersReducedMotion: boolean;
    onRevealProgress: () => void;
  }) => {
    const [revealedText, setRevealedText] = useState(() =>
      revealOnMount && !prefersReducedMotion ? '' : text,
    );

    useEffect(() => {
      setRevealedText((current) => {
        if (prefersReducedMotion || !text.startsWith(current)) return text;
        return current;
      });
    }, [prefersReducedMotion, text]);

    useEffect(() => {
      if (prefersReducedMotion) return;
      const delay = getLiveTranscriptRevealDelay(
        getPendingTranscriptWordCount(text, revealedText),
      );
      if (delay === null) return;
      const timeout = window.setTimeout(
        () =>
          setRevealedText((current) =>
            advanceTranscriptRevealText(text, current),
          ),
        delay,
      );
      return () => window.clearTimeout(timeout);
    }, [prefersReducedMotion, revealedText, text]);

    useLayoutEffect(onRevealProgress, [onRevealProgress, revealedText]);

    const revealing = revealedText !== text;
    return (
      <>
        <span className="transcript-revealed-text" aria-hidden="true">
          {revealedText}
        </span>
        {revealing && (
          <span className="transcript-typewriter-caret" aria-hidden="true" />
        )}
      </>
    );
  },
);

const TranscriptTurn = memo(
  ({
    turn,
    newestSegmentId,
    knownSegmentIds,
    prefersReducedMotion,
    onRevealProgress,
  }: {
    turn: LiveTranscriptTurn;
    newestSegmentId: string | null;
    knownSegmentIds: Set<string>;
    prefersReducedMotion: boolean;
    onRevealProgress: () => void;
  }) => (
    <article className="transcript-turn">
      <div className="transcript-speaker">
        <strong>{turn.speaker}</strong>
        <time>{new Date(turn.timestampMs).toISOString().slice(14, 19)}</time>
      </div>
      <p>
        {turn.segments.map((segment, index) => (
          <Fragment key={segment.id}>
            {index > 0 && <span aria-hidden="true"> </span>}
            <RevealedTranscriptText
              text={segment.text}
              revealOnMount={
                segment.id === newestSegmentId &&
                !knownSegmentIds.has(segment.id)
              }
              prefersReducedMotion={prefersReducedMotion}
              onRevealProgress={onRevealProgress}
            />
          </Fragment>
        ))}
        <span className="sr-only">
          {turn.segments.map((segment) => segment.text).join(' ')}
        </span>
      </p>
    </article>
  ),
);

const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  return prefersReducedMotion;
};

export const LiveTranscript = ({
  segments,
  interimText,
}: { segments: LiveTranscriptSegment[]; interimText: string }) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingLiveRef = useRef(true);
  const knownSegmentIdsRef = useRef(
    new Set(segments.map((segment) => segment.id)),
  );
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const turns = useMemo(() => buildLiveTranscriptTurns(segments), [segments]);
  const newestSegmentId = segments.at(-1)?.id ?? null;
  const visibleTranscriptValidated =
    segments.length > 0 && segments.every((segment) => segment.confirmed);

  const updateFollowingLive = (following: boolean) => {
    followingLiveRef.current = following;
    setIsFollowingLive(following);
  };

  const returnToLive = () => {
    updateFollowingLive(true);
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };

  const followRevealProgress = useCallback(() => {
    const element = scrollRef.current;
    if (element && followingLiveRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, []);

  useLayoutEffect(() => {
    for (const segment of segments) {
      knownSegmentIdsRef.current.add(segment.id);
    }
  }, [segments]);

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
            {segments.length === 0
              ? 'Listening'
              : !isFollowingLive
                ? 'Reviewing earlier'
                : visibleTranscriptValidated
                  ? 'Validated live'
                  : 'Refining live'}
          </span>
        </div>
        <div className="live-transcript-body">
          {segments.length === 0 && !interimText ? (
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
                newestSegmentId={newestSegmentId}
                knownSegmentIds={knownSegmentIdsRef.current}
                prefersReducedMotion={prefersReducedMotion}
                onRevealProgress={followRevealProgress}
              />
            ))
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
