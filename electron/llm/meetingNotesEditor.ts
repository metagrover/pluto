import {
  acceptEditedNotes,
  parseNotesAudit,
  parseNotesDraft,
} from './meetingNotesAudit';
import {
  notesContentGuidance,
  notesSourceFirstGuidance,
  notesSourceGuidance,
} from './meetingNotesGuidance';
import {
  type NotesKnownTerm,
  notesDispositionSchema,
  notesDraftSchema,
  notesTerminologySchema,
} from './meetingNotesPrompts';
import type { NotesDraft, NotesSource } from './meetingNotesTypes';

/** Content-level changes, excluding application-assigned ids and block order. */
export const countEditedBlocks = (
  before: NotesDraft,
  after: NotesDraft,
): number => {
  const signatures = (draft: NotesDraft) =>
    [
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
  inherited,
  compactDraft = false,
  sourceFirstReconciliation = false,
}: {
  sourceText: string;
  draft: unknown;
  userNotes: string;
  knownTerms: NotesKnownTerm[];
  inherited?: unknown[];
  compactDraft?: boolean;
  sourceFirstReconciliation?: boolean;
}): string =>
  [
    'You are the final meeting-notes editor. Return the complete corrected document against the original source. The draft may contain mistakes or omissions; restore missing material topics and current commitments.',
    notesContentGuidance,
    ...(compactDraft
      ? [
          'Before returning, account for every source turn. Preserve all material names, numbers, definitions, reasons and final state changes in the overview or topic discussion, even when a related action or decision is also structured separately.',
          'For every action or decision, copy the source-supported owner into owner and the source-supported deadline into due; use null only when absent.',
          'Stay close to source wording in actions and decisions so deterministic evidence checks can verify them. For an explicit "the decision is" statement, the speaker who states the settled choice is the decision owner. A withdrawal or replacement explanation is discussion, not a separate decision, unless the source explicitly settles it as a choice.',
        ]
      : []),
    ...(sourceFirstReconciliation ? [notesSourceFirstGuidance] : []),
    'Write concise, readable third person notes, naming the relevant speaker when attribution matters. Do not copy unattributed "I" or "we" statements. Each section heading must fit all its items. Avoid repeating the same fact in multiple points.',
    notesSourceGuidance,
    'Optional terminology: Terminology[]. Omit or use [] when no correction is supported.',
    notesTerminologySchema,
    `Known terms with provenance: ${JSON.stringify(knownTerms)}`,
    `User-note emphasis (not factual evidence): ${userNotes}`,
    'BEGIN SOURCE DATA',
    sourceText,
    'END SOURCE DATA',
    ...(sourceFirstReconciliation
      ? []
      : ['BEGIN DRAFT DATA', JSON.stringify(draft), 'END DRAFT DATA']),
    ...(inherited?.length
      ? [
          sourceFirstReconciliation
            ? 'BEGIN SOURCE INVENTORY'
            : 'BEGIN INHERITED COMMITMENTS',
          JSON.stringify(inherited),
          sourceFirstReconciliation
            ? 'END SOURCE INVENTORY'
            : 'END INHERITED COMMITMENTS',
          sourceFirstReconciliation
            ? 'Preserve the id, kind, exact text, evidence, owner and deadline of every retained inventory item. For any omission, add a source-backed disposition targeting its id. Deduplication requires an equivalent retained replacementId. Explain cancellation or supersession in a visible source-backed point. Do not omit facts, negative outcomes, reasons, questions, actions, or decisions merely to shorten notes.'
            : 'Preserve the id of each retained inherited commitment along with its exact text, evidence, owner and deadline, unless original source cancels, supersedes or duplicates it. For omissions, add dispositions: Disposition[]. target is the omitted inherited id. Use cancelled/superseded with source support; for deduplicated, replacementId is the retained inherited id. Explain cancellation/supersession in a source-backed point. Do not omit commitments merely to shorten notes.',
          notesDispositionSchema,
        ]
      : []),
    'Return compact JSON only using these fields:',
    notesDraftSchema,
  ].join('\n');

export const parseEditedNotes = ({
  raw,
  source,
  terminology,
  compactDraft = false,
}: {
  raw: string;
  source: NotesSource;
  terminology?: { trustedUserTerms: string[]; provider: string; model: string };
  compactDraft?: boolean;
}) => {
  const draft: NotesDraft = parseNotesDraft(raw);
  const extra = JSON.parse(raw) as Record<string, unknown>;
  // Reuse validation of optional terminology and hierarchy reconciliation records;
  // no model-generated patches or per-block verdicts are part of this contract.
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
