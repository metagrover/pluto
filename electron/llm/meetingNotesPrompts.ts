import {
  notesContentGuidance,
  notesProseGuidance,
  notesSourceGuidance,
} from './meetingNotesGuidance';
import type { SourceSpan } from './meetingNotesTypes';
import type { MeetingNotesTemplate } from './prompts';

export type NotesKnownTerm = {
  text: string;
  provenance: 'user' | 'entity';
};

type WriterPromptInput = {
  sourceText: string;
  userNotes: string;
  knownTerms: NotesKnownTerm[];
  template: MeetingNotesTemplate;
};

type AuditPromptInput = Omit<WriterPromptInput, 'template'> & {
  draft: unknown;
  inherited?: unknown[];
};

type MergePromptInput = {
  sourceText: string;
  drafts: unknown[];
  inherited: unknown[];
  primaryRanges: SourceSpan[][];
  userNotes: string;
  knownTerms: NotesKnownTerm[];
  template: MeetingNotesTemplate;
};

const sourcePacket = (sourceText: string): string =>
  ['BEGIN SOURCE DATA', sourceText, 'END SOURCE DATA'].join('\n');

const termsPacket = (knownTerms: NotesKnownTerm[]): string =>
  JSON.stringify(
    knownTerms
      .filter(
        (term) =>
          typeof term.text === 'string' &&
          (term.provenance === 'user' || term.provenance === 'entity'),
      )
      .slice(0, 24),
  );

const notesBlockSchema = [
  'Text = {text: nonempty string, sources: copied source descriptor[]}.',
  'Item = {text: nonempty string, sources: copied source descriptor[], kind: "point" | "action" | "decision" | "question", owner: string | null, due: string | null}.',
  'Use kind: "point" for discussion.',
  'Section = {id: string, title: Text, items: Item[]}.',
].join('\n');

export const notesDraftSchema = [
  'Field definitions (not output content):',
  notesBlockSchema,
  'Document = {title: Text | null, meetingType: one_on_one | team_sync | brainstorm | presentation | general, overview: Text | null, sections: Section[], recentWin: {win: Text, impact: Text, ownership: personal | shared | other | unknown, owner: string | null} | null}. title is required and is a concise descriptive title for the overall meeting (max 5-7 words) citing the main topic source descriptor(s), or null only when no trustworthy overall title can be grounded. Do not use a single topic heading as the meeting title unless it represents the whole meeting. recentWin is optional; include only a completed positive event and its source-backed impact. When present, recentWin.win and recentWin.impact must be complete Text blocks, not null. Use personal when the evidence assigns the win to one identifiable person and copy that exact name or speaker label into owner; use shared for an explicitly collective win and owner null; use other when the evidence clearly assigns it outside the participating group; use unknown when ownership cannot be grounded. Do not infer ownership beyond the cited source.',
  'Use null for an uncertain title/overview/recentWin and [] for empty sections/items. The application assigns canonical block ids after parsing.',
].join('\n');

const compactNotesDraftSchema = [
  'Field definitions (not output content):',
  'Title = {text: nonempty string, sources: 1 to at most 3 copied source descriptors}.',
  'Item = {kind: "point" | "action" | "decision" | "question", text: nonempty string, owner: string | null, due: string | null, sources: 1 to at most 3 copied source descriptors}.',
  'Use kind: "point" for discussion.',
  'Section = {title: nonempty string, items: nonempty Item[]}.',
  'Document = {title: Title | null, sections: Section[]}. title is the concise 5-7 word title for the overall meeting, not the first section heading; cite only the source descriptors needed to support the whole-meeting title, and use null when no trustworthy overall title can be grounded. The final editor classifies the meeting.',
  'The title field is required even when its value is null.',
].join('\n');

export const notesDispositionSchema =
  'Disposition = {target: string, kind: deduplicated | cancelled | superseded, replacementId: string | null, sources: copied source descriptor[]}.';

export const notesTerminologySchema = [
  'Terminology = {rawForms: string[], preferredTerm: string | null, segmentIndexes: integer[], confidence: high | medium | low, signals: string[]}.',
  'Use spoken_definition for an explicit definition in cited source, known_entity only for a trusted user term. Code independently checks support; signals cannot authorize corrections. Never alter original source.',
].join('\n');

export const notesAuditCorrectionGuidance = [
  'BEGIN AUDIT CORRECTION GUIDANCE',
  'Work source-first across every provided turn. Put every accepted operation, prerequisite, deadline, owner and recipient from those turns in the action itself; a summary mention is insufficient. Keep unknown details unknown.',
  'Retain material completed-work who/when and explicit personal feelings and reasons as points, without inferring details or converting completed work into tasks.',
  'Distinguish settled decisions from task-scope clarifications. Keep clarifications as points or in the affected action, not separate decisions unless a settled choice is explicit.',
  'Correct all similar errors, not only the first parser target. Correct wording, kind and supporting sources together; include necessary antecedent task scope and acceptance. Use relevant exact descriptors, but inspect all permitted later turns for reversals; never narrow citations to hide contradictory evidence.',
  'Return actual replacements/insertions with matching verdicts for the final text and kind. Approval verdicts alone cannot fix omissions or misclassification. Retain unaffected supported content.',
  'END AUDIT CORRECTION GUIDANCE',
].join('\n');

const auditSchema = [
  'Field definitions (not output content):',
  notesBlockSchema,
  'All audit Text/Item blocks require id: string; sections require unique ids for themselves, titles and items.',
  'Change operations (op is the operation name): replace: {op, target, value: Text | Item}; remove: {op, target}; insert: {op, section, value: Item}; insert_section: {op, value: Section}. target is a block id; section is an existing section id.',
  'Verdict = {target: string, status: supported | uncertain | unsupported, sources: copied source descriptor[]}.',
  notesDispositionSchema,
  notesTerminologySchema,
  'Return {changes: Change[], verdicts: Verdict[], dispositions: Disposition[], terminology: Terminology[]}. Empty-array shape: {"changes":[],"verdicts":[],"dispositions":[],"terminology":[]}.',
].join('\n');

const reviewTargets = (draft: unknown): string[] => {
  if (!draft || typeof draft !== 'object') return [];
  if (Array.isArray(draft)) return draft.flatMap(reviewTargets);
  const record = draft as Record<string, unknown>;
  if (typeof record.id === 'string' && typeof record.text === 'string')
    return [record.id];
  return Object.values(record).flatMap(reviewTargets);
};

export const buildNotesWriterPrompt = ({
  sourceText,
  userNotes,
  knownTerms,
  template,
}: WriterPromptInput): string =>
  [
    'You produce compact, source-grounded Pluto meeting-note drafts.',
    notesContentGuidance,
    notesProseGuidance,
    'Every still-valid commitment belongs in a kind:action item. An overview mention is not a substitute for an action. Do not emit document rollups; code derives them from retained items.',
    notesSourceGuidance,
    '',
    `Known terminology hints (entity hints are not trusted corrections): ${termsPacket(knownTerms)}`,
    `Template: ${template}`,
    'User-note emphasis:',
    userNotes,
    '',
    sourcePacket(sourceText),
    '',
    'Return compact JSON only using these fields:',
    notesDraftSchema,
  ].join('\n');

export const buildCompactNotesWriterPrompt = ({
  sourceText,
  userNotes,
  knownTerms,
  template,
}: WriterPromptInput): string =>
  [
    'You produce compact, source-grounded Pluto meeting-note drafts.',
    notesContentGuidance,
    notesProseGuidance,
    'Return the overall meeting title plus useful note items. Code derives the overview and section-heading evidence; do not substitute the first section heading for the overall title.',
    'Before returning, account for every source turn. Preserve all material names, numbers, definitions, reasons, state changes and current commitments; compact repetition, not facts.',
    'For actions and decisions, copy the supported owner and deadline into owner and due. Use null when absent. Keep the task, recipient, condition and deadline clear in the text itself.',
    'Stay close to source wording in actions and decisions so deterministic evidence checks can verify them. For an explicit "the decision is" statement, use its speaker as owner. A withdrawal or replacement explanation is discussion, not a separate decision, unless the source explicitly settles it as a choice.',
    'For each item, cite only the 1 to 3 source labels needed to support its exact claim.',
    notesSourceGuidance,
    '',
    `Known terminology hints (entity hints are not trusted corrections): ${termsPacket(knownTerms)}`,
    `Template: ${template}`,
    'User-note emphasis:',
    userNotes,
    '',
    sourcePacket(sourceText),
    '',
    'Return compact JSON only using these fields:',
    compactNotesDraftSchema,
  ].join('\n');

export const buildNotesAuditPrompt = ({
  sourceText,
  draft,
  inherited,
  userNotes,
  knownTerms,
}: AuditPromptInput): string =>
  [
    'Audit the draft against the original source, not against your general knowledge.',
    notesContentGuidance,
    notesAuditCorrectionGuidance,
    'Scan the source for missing commitments even if the draft has zero actions.',
    'First read EVERY source turn independently of the draft. Insert every missed current commitment as an action; overview/point mentions do not count. Then review existing blocks.',
    'Check missing operations, their current status, offer dispositions and person references against all source turns in every text block, including headings, overview and recentWin. Use existing changes to correct omissions or unsupported details, not just verdicts that approve the draft.',
    'Check every title, overview sentence, point, action, decision, question, and both the win and why it counts when a recentWin is present.',
    'Review the item kind separately from the wording. Replace misclassified items with the correct kind: settled choices belong in decisions, unresolved questions in questions, and material discussion in points. An unchanged action verdict certifies its kind, owner, conditions and deadline as well as wording. Do not rewrite correct text for style.',
    'Return one verdict for EVERY retained target, including unchanged titles and overview. Missing verdicts invalidate the entire audit. Use the exact ids from the draft, not section ids or field paths. Removed blocks need no verdict. Every inserted block needs its own verdict.',
    'Verdict sources must support final target text; for unsupported claims cite contradicting source. For replace of an item, include kind, owner and due (null when absent). Insert missed items with unique ids; use insert_section if no section exists.',
    notesSourceGuidance,
    '',
    `Known terminology hints (entity hints remain untrusted): ${termsPacket(knownTerms)}`,
    'User-note emphasis:',
    userNotes,
    '',
    sourcePacket(sourceText),
    '',
    'BEGIN DRAFT DATA',
    JSON.stringify(draft),
    'END DRAFT DATA',
    `REQUIRED REVIEW TARGETS: ${JSON.stringify(reviewTargets(draft))}`,
    ...(inherited
      ? [
          'BEGIN INHERITED COMMITMENTS',
          JSON.stringify(inherited),
          'END INHERITED COMMITMENTS',
        ]
      : []),
    '',
    'Return compact JSON only using these fields:',
    auditSchema,
    ...(inherited?.length
      ? []
      : [
          'This is a direct source audit: dispositions must be []. Keep source-backed withdrawals and their reasons as point items. If a withdrawn task is still an active action, correct its kind and wording; preserve the discussion explaining the withdrawal.',
        ]),
  ].join('\n');

export const buildNotesMergePrompt = ({
  sourceText,
  drafts,
  inherited,
  primaryRanges,
  userNotes,
  knownTerms,
  template,
}: MergePromptInput): string =>
  [
    'Consolidate source-grounded child meeting-note drafts into one compact draft.',
    notesContentGuidance,
    notesSourceGuidance,
    'Child drafts are not evidence. Use the original evidence excerpts to retain, qualify, cancel, or supersede claims.',
    'Do not conflate identical task wording from different speakers or source spans.',
    'Every inherited action or decision must survive unchanged, or the later audit must give it an explicit supported disposition.',
    `Known terminology hints (entity hints remain untrusted): ${termsPacket(knownTerms)}`,
    `Template: ${template}`,
    'User-note emphasis:',
    userNotes,
    '',
    sourcePacket(sourceText),
    '',
    'BEGIN CHILD DRAFTS',
    JSON.stringify(drafts),
    'END CHILD DRAFTS',
    'BEGIN INHERITED COMMITMENTS',
    JSON.stringify(inherited),
    'END INHERITED COMMITMENTS',
    'BEGIN PRIMARY COVERAGE',
    JSON.stringify(primaryRanges),
    'END PRIMARY COVERAGE',
    '',
    'Return compact JSON only using these fields:',
    notesDraftSchema,
  ].join('\n');
