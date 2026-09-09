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
      aria-label="Draft notes preview"
      className="mx-auto w-full max-w-[760px] px-5 py-4 md:px-8"
    >
      <p className="mb-1 text-sm font-medium text-pro-text">
        Draft preview · reviewing
      </p>
      <p className="mb-5 text-sm text-pro-text-muted">
        These notes are incomplete and may change. They are not saved yet.
      </p>
      {preview.sections.map((section, index) => (
        <div key={`${index}-${section.title}`} className="mb-5">
          <h3 className="mb-2 font-medium text-pro-text">{section.title}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-pro-text">
            {section.items.map((text, itemIndex) => (
              <li key={`${itemIndex}-${text}`}>{text}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
