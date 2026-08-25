import { CircleStop, Loader2 } from 'lucide-react';
import type { RecordingFinalizationPreview } from './recordingWorkspaceModel';

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

export const RecordingFinalizingView = ({
  meeting,
}: { meeting: RecordingFinalizationPreview }) => (
  <article
    className="recording-finalizing-view"
    aria-labelledby="recording-finalizing-title"
    aria-busy="true"
  >
    <header className="recording-finalizing-header">
      <p className="workspace-eyebrow">Finishing meeting</p>
      <h1 id="recording-finalizing-title">{meeting.title}</h1>
      <div className="recording-finalizing-meta">
        <span>{formatDuration(meeting.durationSeconds)}</span>
        <span>
          <CircleStop aria-hidden="true" size={13} /> Recording stopped
        </span>
      </div>
    </header>

    <section className="recording-finalizing-status" aria-live="polite">
      <span className="recording-finalizing-icon" aria-hidden="true">
        <Loader2 size={17} />
      </span>
      <div>
        <h2>Preparing your meeting</h2>
        <p>
          Pluto is securing the recording. Transcript and notes will appear here
          as they become ready. You can keep using Pluto.
        </p>
      </div>
    </section>

    <section className="recording-finalizing-document">
      <div className="recording-finalizing-copy">
        <p className="workspace-eyebrow">Your live note</p>
        {meeting.userNotes.trim() ? (
          <p className="recording-finalizing-note">{meeting.userNotes}</p>
        ) : (
          <p className="recording-finalizing-note recording-finalizing-note--empty">
            No live note was added during this meeting.
          </p>
        )}
      </div>
      <div className="recording-finalizing-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  </article>
);
