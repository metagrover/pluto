import { Loader2, LockKeyhole } from 'lucide-react';
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
        <output className="meeting-document-save-row" aria-live="polite">
          <span className="meeting-save-state meeting-save-state--saving">
            <Loader2 aria-hidden="true" size={13} className="animate-spin" />
            <span>Drafting notes</span>
          </span>
        </output>

        <header className="meeting-notes-draft-status">
          <div className="meeting-notes-draft-status__indicator">
            <Loader2
              aria-hidden="true"
              size={14}
              className="animate-spin text-pro-accent shrink-0"
            />
            <span className="font-semibold text-pro-text-main">
              {isRetry ? 'Taking another pass' : 'Drafting your notes'}
            </span>
            <span className="meeting-notes-draft-status__badge">
              <LockKeyhole aria-hidden="true" size={11} />
              View only
            </span>
          </div>
          <p className="meeting-notes-draft-status__unlock">
            Editing unlocks automatically when your notes are ready.
          </p>
        </header>

        <div className="meeting-notes-draft__content">
          {preview.sections.map((section, index) => {
            const isLatestSection = index === preview.sections.length - 1;
            return (
              <section
                key={`${index}-${section.title}`}
                className="meeting-notes-section"
                data-notes-section="preview"
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

          {/* Trailing skeleton loader utilizing existing meeting-analysis-skeleton styling */}
          <div
            className="meeting-analysis-skeleton__lines mt-8 space-y-4"
            aria-hidden="true"
          >
            <div className="flex items-start gap-3">
              <span className="meeting-note-block__marker mt-[0.75rem] opacity-30 animate-pulse" />
              <div className="w-full space-y-2 pt-0.5">
                <div className="h-3.5 w-4/5 rounded bg-pro-text-muted/10 animate-pulse motion-reduce:animate-none" />
                <div className="h-3.5 w-3/5 rounded bg-pro-text-muted/10 animate-pulse motion-reduce:animate-none" />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="meeting-note-block__marker mt-[0.75rem] opacity-20 animate-pulse" />
              <div className="w-full space-y-2 pt-0.5">
                <div className="h-3.5 w-2/3 rounded bg-pro-text-muted/10 animate-pulse motion-reduce:animate-none" />
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
