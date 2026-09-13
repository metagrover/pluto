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
    <section
      aria-busy="true"
      aria-label="Notes are being drafted"
      className="meeting-notes-draft"
      data-meeting-artifact="analysis"
      data-state="drafting"
    >
      <div className="meeting-notes-draft__frame">
        <header className="meeting-notes-draft__header">
          <div className="flex items-center gap-3 min-w-0">
            <span className="meeting-notes-draft__activity" aria-hidden="true">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="meeting-notes-draft__status">
              <p aria-live="polite" role="status">
                <span>
                  {isRetry ? 'Taking another pass' : 'Drafting your notes'}
                </span>
                <span className="meeting-notes-draft__dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </p>
              <span>
                {isRetry
                  ? 'Pluto is taking another pass to produce a clear, useful summary.'
                  : 'Pluto is shaping the discussion into a clear, useful summary.'}
              </span>
            </div>
          </div>
          <span className="meeting-notes-draft__readonly">
            <LockKeyhole className="h-3 w-3" aria-hidden="true" />
            <span>View only</span>
          </span>
        </header>

        <div className="meeting-notes-draft__document">
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

          {/* Trailing skeleton loader showing more notes are actively being written */}
          <div
            className="meeting-draft-skeleton mt-6 pl-1 space-y-3"
            aria-hidden="true"
          >
            <div className="flex items-start gap-3">
              <span className="meeting-note-block__marker mt-[0.75rem] opacity-40 animate-pulse" />
              <div className="w-full space-y-2.5 pt-0.5">
                <div className="h-3.5 w-4/5 rounded bg-pro-text-muted/10 animate-pulse motion-reduce:animate-none" />
                <div className="h-3.5 w-3/5 rounded bg-pro-text-muted/10 animate-pulse motion-reduce:animate-none" />
              </div>
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
