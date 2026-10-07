import {
  acceptEditedNotes,
  applyNotesChanges,
  parseNotesAudit,
  parseNotesDraft,
} from './meetingNotesAudit';
import { NOTES_EXPERIMENTS_ENABLED } from './meetingNotesExperiments';
import {
  notesContentGuidance,
  notesProseGuidance,
  notesSourceGuidance,
} from './meetingNotesGuidance';
import {
  type NotesKnownTerm,
  notesDispositionSchema,
  notesDraftSchema,
  notesTerminologySchema,
} from './meetingNotesPrompts';
import { resolveSourceSpan } from './meetingNotesSource';
import type { MeetingNotesTemplateInput } from './meetingNotesTemplates';
import {
  MeetingNotesError,
  type NotesDraft,
  type NotesSource,
} from './meetingNotesTypes';
import { getTemplateGuidance } from './prompts';

/** Content-level changes, excluding application-assigned ids and block order. */
export const countEditedBlocks = (
  before: NotesDraft,
  after: NotesDraft,
): number => {
  const signatures = (draft: NotesDraft) =>
    [
      ...(draft.title ? [{ role: 'meetingTitle', ...draft.title }] : []),
      ...(draft.overview ? [{ role: 'overview', ...draft.overview }] : []),
      ...draft.sections.flatMap((section) => [
        { role: 'title', ...section.title },
        ...section.items.map((item) => ({ role: 'item', ...item })),
      ]),
      ...(draft.recentWin
        ? [
            { role: 'win', ...draft.recentWin.win },
            { role: 'impact', ...draft.recentWin.impact },
          ]
        : []),
    ].map(({ id: _id, ...content }) => JSON.stringify(content));
  const old = signatures(before);
  const remaining = signatures(after);
  let removed = 0;
  for (const signature of old) {
    const index = remaining.indexOf(signature);
    if (index < 0) removed++;
    else remaining.splice(index, 1);
  }
  return Math.max(removed, remaining.length);
};

export const buildNotesEditorPrompt = ({
  sourceText,
  draft,
  userNotes,
  knownTerms,
  template = 'auto',
  inherited,
  compactDraft = false,
  correctionOnly = false,
}: {
  sourceText: string;
  draft: unknown;
  userNotes: string;
  knownTerms: NotesKnownTerm[];
  template?: MeetingNotesTemplateInput;
  inherited?: unknown[];
  compactDraft?: boolean;
  correctionOnly?: boolean;
}): string =>
  [
    NOTES_EXPERIMENTS_ENABLED && correctionOnly
      ? 'You are the final meeting-notes editor. Read every original source turn and review the entire draft. Return only necessary corrections, including additions for missing material topics and current commitments. Do not rewrite correct text for style.'
      : 'You are the final meeting-notes editor. Return the complete corrected document against the original source. The draft may contain mistakes or omissions; restore missing material topics and current commitments.',
    notesContentGuidance,
    NOTES_EXPERIMENTS_ENABLED && correctionOnly
      ? 'Omit title, overview, meetingType and recentWin when unchanged. If present, these replace the corresponding field. The title must describe the overall meeting, not just its first section.'
      : 'The title field is required. It must describe the overall meeting rather than the first section; return null only when no trustworthy overall title can be grounded.',
    ...(compactDraft
      ? [
          'Before returning, account for every source turn. Preserve all material names, numbers, definitions, reasons and final state changes in the overview or topic discussion, even when a related action or decision is also structured separately.',
          'For every action or decision, copy the source-supported owner into owner and the source-supported deadline into due; use null only when absent.',
          'Stay close to source wording in actions and decisions so deterministic evidence checks can verify them. For an explicit "the decision is" statement, the speaker who states the settled choice is the decision owner. A withdrawal or replacement explanation is discussion, not a separate decision, unless the source explicitly settles it as a choice.',
        ]
      : []),
    notesProseGuidance,
    notesSourceGuidance,
    getTemplateGuidance(template),
    'Optional terminology: Terminology[]. Omit or use [] when no correction is supported.',
    notesTerminologySchema,
    `Known terms with provenance: ${JSON.stringify(knownTerms)}`,
    `User-note emphasis (not factual evidence): ${userNotes}`,
    'BEGIN SOURCE DATA',
    sourceText,
    'END SOURCE DATA',
    'BEGIN DRAFT DATA',
    JSON.stringify(draft),
    'END DRAFT DATA',
    ...(inherited?.length
      ? [
          'BEGIN INHERITED COMMITMENTS',
          JSON.stringify(inherited),
          'END INHERITED COMMITMENTS',
          'Preserve the id of each retained inherited commitment along with its exact text, evidence, owner and deadline, unless original source cancels, supersedes or duplicates it. For omissions, add dispositions: Disposition[]. target is the omitted inherited id. Use cancelled/superseded with source support; for deduplicated, replacementId is the retained inherited id. Explain cancellation/supersession in a source-backed point. Do not omit commitments merely to shorten notes.',
          notesDispositionSchema,
        ]
      : []),
    'Return compact JSON only using these fields:',
    ...(NOTES_EXPERIMENTS_ENABLED && correctionOnly
      ? [
          'Return {changes:[],dispositions:[],terminology:[]}, plus only changed title, overview, meetingType or recentWin fields using the document schema below.',
          'changes operations: {op:"replace",target:"existing block id",value:{text,sources,kind,owner,due}}; {op:"remove",target:"existing block id"}; {op:"insert",section:"existing section id",value:{id,kind,text,owner,due,sources}}; {op:"insert_section",value:{id,title:{id,text,sources},items:[]}}. For heading replacements, value contains text and sources. Use each target once. New ids must be unique. Preserve source-backed discussion when reclassifying or removing a commitment. Empty changes means the entire source was reviewed and no corrections were needed. No verdicts or unchanged sections.',
          notesDraftSchema,
        ]
      : [notesDraftSchema]),
  ].join('\n');

export const parseEditedNotes = ({
  raw,
  source,
  terminology,
  compactDraft = false,
  originalDraft,
}: {
  raw: string;
  source: NotesSource;
  terminology?: { trustedUserTerms: string[]; provider: string; model: string };
  compactDraft?: boolean;
  originalDraft?: NotesDraft;
}) => {
  let draft: NotesDraft =
    NOTES_EXPERIMENTS_ENABLED && originalDraft
      ? structuredClone(originalDraft)
      : parseNotesDraft(raw);
  let extra: Record<string, unknown>;
  try {
    extra = JSON.parse(raw);
  } catch {
    throw new MeetingNotesError('notes_audit_invalid');
  }
  if (NOTES_EXPERIMENTS_ENABLED && originalDraft) {
    const next = structuredClone(originalDraft);
    const corrections = parseNotesAudit(
      JSON.stringify({ ...extra, verdicts: [] }),
    );
    applyNotesChanges(next, corrections.changes, (spans) => {
      if (!spans.length) throw new MeetingNotesError('invalid_source_span');
      spans.forEach((span) => resolveSourceSpan(source, span));
    });
    for (const field of [
      'title',
      'overview',
      'meetingType',
      'recentWin',
    ] as const) {
      if (Object.hasOwn(extra, field))
        Object.assign(next, { [field]: extra[field] });
    }
    draft = parseNotesDraft(JSON.stringify(next));
  }
  // Both editor contracts share terminology reconciliation and semantic acceptance;
  // correction-only output does not invent per-block model verdicts.
  const audit = parseNotesAudit(
    JSON.stringify({
      changes: [],
      verdicts: [],
      dispositions: extra.dispositions ?? [],
      terminology: extra.terminology ?? [],
    }),
  );
  const audited = acceptEditedNotes({
    source,
    draft,
    terminology,
    proposals: audit.terminology,
    compactNormalization: compactDraft,
  });
  return { draft: audited.draft, audited, audit };
};
