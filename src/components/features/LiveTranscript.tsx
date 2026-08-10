import { useEffect, useState } from 'react';
import {
  advanceLiveTranscriptReveal,
  createLiveTranscriptRevealState,
  getActiveLiveTranscriptRevealId,
  getLiveTranscriptRevealDelay,
  getPendingLiveTranscriptWordCount,
  getRevealedTranscriptText,
  reconcileLiveTranscriptReveal,
} from '../../utils/liveTranscriptReveal';
import type { LiveTranscriptSegment } from './recordingWorkspaceModel';

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
  const [revealState, setRevealState] = useState(() =>
    createLiveTranscriptRevealState(segments),
  );

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

  const activeRevealId = getActiveLiveTranscriptRevealId(revealState);

  return (
    <section
      className="live-transcript"
      aria-labelledby="live-transcript-title"
    >
      <div className="live-transcript-heading">
        <div>
          <p className="workspace-eyebrow">Conversation</p>
          <h1 id="live-transcript-title">Live transcript</h1>
        </div>
        <span>{segments.length > 0 ? 'Following live' : 'Listening'}</span>
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
          segments.map((segment) => (
            <article className="transcript-turn" key={segment.id}>
              <div className="transcript-speaker">
                <strong>{segment.speaker}</strong>
                <time>
                  {new Date(segment.timestampMs).toISOString().slice(14, 19)}
                </time>
              </div>
              <p>
                <span className="transcript-revealed-text" aria-hidden="true">
                  {getRevealedTranscriptText(revealState, segment.id)}
                </span>
                {activeRevealId === segment.id && (
                  <span
                    className="transcript-typewriter-caret"
                    aria-hidden="true"
                  />
                )}
                <span className="sr-only">{segment.text}</span>
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
    </section>
  );
};
