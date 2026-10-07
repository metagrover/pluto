import { parseCompactNotesDraft } from './meetingNotesAudit';
import { resolveSourceSpan } from './meetingNotesSource';
import type { NotesDraft, NotesSource, SourceSpan } from './meetingNotesTypes';

/** Complete JSON items only, never repaired text or an acceptance/publication path.
 * Closing the surrounding containers produces a temporary parseable prefix; an
 * incomplete string/item cannot become visible. Final generation validates the
 * actual unmodified response separately.
 */
export function createNotesStreamPreview(input: {
  source: NotesSource;
  spans: SourceSpan[];
  decode: (raw: string) => string;
  maxSourceSpans?: number;
  onDraft: (draft: NotesDraft) => void;
  signal?: AbortSignal;
}) {
  const key = (span: SourceSpan) => `${span.segment}:${span.start}:${span.end}`;
  const allowed = new Set(input.spans.map(key));
  const fullSource = input.source.segments
    .filter((s) => s.text.trim())
    .every((s) =>
      allowed.has(key({ segment: s.index, start: 0, end: s.text.length })),
    );
  let last = '';
  const emit = (draft: NotesDraft) => {
    const identity = JSON.stringify(draft);
    if (identity === last || input.signal?.aborted) return;
    last = identity;
    try {
      input.onDraft(draft);
    } catch {
      /* UI observers cannot affect generation. */
    }
  };
  return (answer: string) => {
    if (!fullSource || input.signal?.aborted) return;
    if (!answer) {
      // A resumed physical request has a new answer buffer. Never concatenate
      // fragments or keep a previous attempt visible as the current draft.
      if (last) emit({ meetingType: 'general', overview: null, sections: [] });
      last = '';
      return;
    }
    if (answer.length > 64_000) return;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    let candidate: NotesDraft | undefined;
    for (let index = 0; index < answer.length; index++) {
      const char = answer[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') {
        quoted = true;
        continue;
      }
      if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
      if (char !== '}' && char !== ']') continue;
      if (stack.pop() !== char) return;
      if (char !== '}') continue;
      try {
        const raw = answer.slice(0, index + 1) + [...stack].reverse().join('');
        const draft = parseCompactNotesDraft(
          input.decode(raw),
          input.maxSourceSpans,
        );
        if (!draft.sections.some((s) => s.items.length)) continue;
        for (const section of draft.sections)
          for (const item of section.items)
            for (const span of item.sources) {
              if (!allowed.has(key(span)))
                throw new Error('preview_source_not_allowed');
              resolveSourceSpan(input.source, span);
            }
        candidate = draft;
      } catch {
        /* An incomplete prefix is expected, not a model repair. */
      }
    }
    if (candidate) emit(candidate);
  };
}
