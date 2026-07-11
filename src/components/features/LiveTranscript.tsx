import type { LiveTranscriptSegment } from './recordingWorkspaceModel';

export const LiveTranscript = ({
  segments,
  interimText,
}: { segments: LiveTranscriptSegment[]; interimText: string }) => (
  <section className="live-transcript" aria-labelledby="live-transcript-title">
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
          <span>The conversation will appear here as speech is confirmed.</span>
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
            <p>{segment.text}</p>
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
