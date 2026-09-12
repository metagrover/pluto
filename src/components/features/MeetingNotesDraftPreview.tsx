import { LockKeyhole, Sparkles } from 'lucide-react';
import type { Meeting, MeetingNotesPreview } from '../../types';

export function currentNotesPreview(
  meeting: Meeting,
): MeetingNotesPreview | null {
  const preview = meeting.notes_preview;
  if (!preview) return null;
  try {
    const run = JSON.parse(meeting.analysis_run_json || '{}');
    return run.notes_status === 'running' && run.run_id === preview.runId
      ? preview
      : null;
  } catch {
    return null;
  }
}

/** Plain React text only; never render model HTML or expose draft editing/export. */
export function MeetingNotesDraftPreview({
  preview,
}: { preview: MeetingNotesPreview }) {
  return (
    <section
      aria-busy="true"
      aria-label="Notes are being drafted"
      className="meeting-notes-draft"
      data-meeting-artifact="analysis"
      data-state="drafting"
    >
      <div className="meeting-notes-draft__frame">
        <header className="meeting-notes-draft__header">
          <span className="meeting-notes-draft__activity" aria-hidden="true">
            <Sparkles />
          </span>
          <div className="meeting-notes-draft__status">
            <p aria-live="polite" role="status">
              Drafting your notes
              <span className="meeting-notes-draft__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </p>
            <span>
              Pluto is shaping the discussion into a clear, useful summary.
            </span>
          </div>
          <span className="meeting-notes-draft__readonly">
            <LockKeyhole aria-hidden="true" />
            View only
          </span>
        </header>

        <div className="meeting-notes-draft__document">
          {preview.sections.map((section, index) => (
            <div
              key={`${index}-${section.title}`}
              className="meeting-notes-draft__section"
            >
              <h3>{section.title}</h3>
              <ul>
                {section.items.map((text, itemIndex) => (
                  <li key={`${itemIndex}-${text}`}>{text}</li>
                ))}
              </ul>
            </div>
          ))}

          <div className="meeting-notes-draft__writing" aria-hidden="true">
            <span>Continuing the draft</span>
            <div className="meeting-notes-draft__writing-lines">
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>

        <footer className="meeting-notes-draft__footer">
          Editing unlocks automatically when your notes are ready.
        </footer>
      </div>
    </section>
  );
}
