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

interface MeetingNotesDraftPreviewProps {
  preview: MeetingNotesPreview;
  isRetry?: boolean;
}

/** Plain React text only; never render model HTML or expose draft editing/export. */
export function MeetingNotesDraftPreview({
  preview,
  isRetry = false,
}: MeetingNotesDraftPreviewProps) {
  return (
    <div className="meeting-document-workspace">
      <article
        aria-busy="true"
        aria-label="Notes are being drafted"
        className="meeting-notes-document meeting-notes-document--drafting"
        data-reading-surface="meeting-notes"
        data-meeting-artifact="analysis"
        data-state="drafting"
      >
        <div className="meeting-draft-status-row" aria-live="polite">
          <span className="meeting-draft-status-badge">
            <Sparkles className="h-3 w-3 animate-pulse text-pro-accent" />
            <span>
              {isRetry
                ? 'Drafting your notes (taking another pass)'
                : 'Drafting your notes'}
            </span>
          </span>
          <span className="meeting-draft-readonly-badge">
            <LockKeyhole
              className="h-3 w-3 text-pro-text-muted"
              aria-hidden="true"
            />
            <span>View only</span>
          </span>
        </div>

        {preview.sections.map((section, index) => {
          const isLatestSection = index === preview.sections.length - 1;
          return (
            <section
              key={`${index}-${section.title}`}
              className="meeting-notes-section"
            >
              <h2>
                {section.title}
                {isLatestSection && section.items.length === 0 && (
                  <span
                    className="meeting-typewriter-caret"
                    aria-hidden="true"
                  />
                )}
              </h2>
              <div className="meeting-notes-section__content">
                {section.items.map((text, itemIndex) => {
                  const isLatestItem =
                    isLatestSection && itemIndex === section.items.length - 1;
                  return (
                    <div
                      key={`${itemIndex}-${text}`}
                      className="meeting-note-block meeting-note-block--streaming"
                    >
                      <span
                        className="meeting-note-block__marker"
                        aria-hidden="true"
                      />
                      <div className="meeting-note-block__body">
                        <p>
                          {text}
                          {isLatestItem && (
                            <span
                              className="meeting-typewriter-caret"
                              aria-hidden="true"
                            />
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <footer className="mt-12 border-t border-pro-border/30 pt-4 text-xs text-pro-text-muted">
          Editing unlocks automatically when your notes are ready.
        </footer>
      </article>
    </div>
  );
}
