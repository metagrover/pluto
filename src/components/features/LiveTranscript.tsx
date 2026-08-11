import { ArrowDown } from 'lucide-react';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  advanceLiveTranscriptReveal,
  createLiveTranscriptRevealState,
  getActiveLiveTranscriptRevealId,
  getLiveTranscriptRevealDelay,
  getPendingLiveTranscriptWordCount,
  getRevealedTranscriptText,
  reconcileLiveTranscriptReveal,
} from '../../utils/liveTranscriptReveal';
import { buildLiveTranscriptTurns } from './liveTranscriptPresentation';
import type { LiveTranscriptSegment } from './recordingWorkspaceModel';

const LIVE_EDGE_TOLERANCE_PX = 48;

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
  const [isFollowingLive, setIsFollowingLive] = useState(true);
  const [revealState, setRevealState] = useState(() =>
    createLiveTranscriptRevealState(segments),
  );
  const turns = useMemo(() => buildLiveTranscriptTurns(segments), [segments]);

  const updateFollowingLive = (following: boolean) => {
    followingLiveRef.current = following;
    setIsFollowingLive(following);
  };

  const returnToLive = () => {
    updateFollowingLive(true);
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };

  useEffect(() => {
    setRevealState((current) =>
      reconcileLiveTranscriptReveal(current, segments, {
        revealImmediately: prefersReducedMotion,
      }),
    );
  }, [prefersReducedMotion, segments]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const delay = getLiveTranscriptRevealDelay(
      getPendingLiveTranscriptWordCount(revealState),
    );
    if (delay === null) return;

    const timeout = window.setTimeout(
      () => setRevealState((current) => advanceLiveTranscriptReveal(current)),
      delay,
    );
    return () => window.clearTimeout(timeout);
  }, [prefersReducedMotion, revealState]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !followingLiveRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [interimText, revealState]);

  const activeRevealId = getActiveLiveTranscriptRevealId(revealState);

  return (
    <section
      className="live-transcript"
      aria-labelledby="live-transcript-title"
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
              : isFollowingLive
                ? 'Following live'
                : 'Reviewing earlier'}
          </span>
        </div>
        <div className="live-transcript-body">
          {segments.length === 0 && !interimText ? (
            <div className="transcript-waiting">
              <p>Pluto is listening.</p>
              <span>
                The conversation will appear here as speech is confirmed.
              </span>
            </div>
          ) : (
            turns.map((turn) => (
              <article className="transcript-turn" key={turn.id}>
                <div className="transcript-speaker">
                  <strong>{turn.speaker}</strong>
                  <time>
                    {new Date(turn.timestampMs).toISOString().slice(14, 19)}
                  </time>
                </div>
                <p>
                  {turn.segments.map((segment, index) => (
                    <Fragment key={segment.id}>
                      {index > 0 && <span aria-hidden="true"> </span>}
                      <span
                        className="transcript-revealed-text"
                        aria-hidden="true"
                      >
                        {getRevealedTranscriptText(revealState, segment.id)}
                      </span>
                      {activeRevealId === segment.id && (
                        <span
                          className="transcript-typewriter-caret"
                          aria-hidden="true"
                        />
                      )}
                    </Fragment>
                  ))}
                  <span className="sr-only">
                    {turn.segments.map((segment) => segment.text).join(' ')}
                  </span>
                </p>
              </article>
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
