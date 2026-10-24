import {
  notesContentGuidance,
  notesProseGuidance,
  notesSourceGuidance,
} from './meetingNotesGuidance';
import type { MeetingNotesTemplateInput } from './meetingNotesTemplates';
import type { SourceSpan } from './meetingNotesTypes';
import { getTemplateGuidance } from './prompts';

export type NotesKnownTerm = {
  text: string;
  provenance: 'user' | 'entity';
};

type WriterPromptInput = {
  maxSourceSpans?: number;
  sourceText: string;
  userNotes: string;
  knownTerms: NotesKnownTerm[];
  template: MeetingNotesTemplateInput;
};

type AuditPromptInput = WriterPromptInput & {
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
  template: MeetingNotesTemplateInput;
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
  'Section = {title: Text, items: Item[]}.',
].join('\n');

export const notesDraftSchema = [
  'Field definitions (not output content):',
  notesBlockSchema,
  'Document = {title: Text | null, meetingType: one_on_one | team_sync | brainstorm | presentation | general, overview: Text | null, sections: Section[], recentWin: {win: Text, impact: Text, ownership: personal | shared | other | unknown, owner: string | null} | null}. Follow the supplied schema for required fields. Use a concise grounded title for the overall conversation, not merely its first section, or null when uncertain. The overview is a brief source-supported summary, or null.',
  'recentWin is optional: include only a completed positive event with an explicitly supported impact. recentWin.win and recentWin.impact must be complete Text blocks, not null. Set ownership to personal with its exact source-backed owner, shared with owner null for a collective event, other for an event outside the participating group, or unknown when ungrounded. Do not invent an impact or owner to fill this field.',
  'Use null for uncertain optional metadata and [] for empty sections/items. The application assigns canonical block ids after parsing; do not invent ids unless this stage explicitly requires them.',
].join('\n');

const compactNotesDraftSchema = [
  'Field definitions (not output content):',
  'Title = {text: nonempty string, sources: 1 to at most 3 copied source descriptors}.',
  'Overview = {text: nonempty string, sources: 1 to at most 3 copied source descriptors}. Write a concise 1-2 sentence overview in readable prose that connects the main topics and outcomes; cite the source descriptors supporting it. Use null when no trustworthy overview can be grounded.',
  'Item = {kind: "point" | "action" | "decision" | "question", text: nonempty string, owner: string | null, due: string | null, sources: 1 to at most 3 copied source descriptors}.',
  'Use kind: "point" for discussion. Points and questions have null owner and due.',
  'For actions and decisions, owner and due must be source-supported, or null when unknown. First-person responsibilities use the recorded canonical speaker as owner. Use an unconfirmed introduced name only when the item cites both the standalone same-speaker introduction and its responsibility; otherwise keep the recorded label. Never rename Me or a confirmed recorded speaker. Explicitly named reported third-party owners remain valid independently of the speaker roster.',
  'Section = {title: nonempty string, items: nonempty Item[]}.',
  'Document = {title: Title | null, overview: Overview | null, sections: Section[]}. title is a concise grounded title for the overall conversation, not the first section heading; cite only the source descriptors needed to support the whole-meeting title, and use null when no trustworthy overall title can be grounded. Do not add fields outside this compact contract.',
  'The title and overview fields are required even when their values are null.',
].join('\n');

export const notesDispositionSchema =
  'Disposition = {target: string, kind: deduplicated | cancelled | superseded, replacementId: string | null, sources: copied source descriptor[]}.';

export const notesTerminologySchema = [
  'Terminology = {rawForms: string[], preferredTerm: string | null, segmentIndexes: integer[], confidence: high | medium | low, signals: string[]}.',
  'Use spoken_definition for an explicit definition in cited source, known_entity only for a trusted user term. Code independently checks support; signals cannot authorize corrections. Never alter original source.',
].join('\n');

export const notesAuditCorrectionGuidance = [
  'BEGIN AUDIT CORRECTION GUIDANCE',
  'Every turn: put every accepted operation, prerequisite, deadline, owner and recipient in the action itself; a summary mention is insufficient. Unknowns stay unknown.',
  'Retain completed-work who/when and explicit personal feelings and reasons as points; infer nothing and never reopen work.',
  'Separate historical cancellation/completion points from current replacement decisions/actions, each with own evidence; retain both and prerequisites. Never delete supported content to pass validation.',
  'Distinguish settled decisions from task-scope clarifications; keep the latter as points or in the affected action.',
  'Correct all similar errors, not only the first parser target: wording, kind and supporting sources together, including antecedent task scope and acceptance. Use relevant exact descriptors; inspect all permitted later turns for reversals; never narrow citations to hide contradictory evidence.',
  'Return actual replacements/insertions with matching verdicts for final text/kind. Retain unaffected supported content; approval alone cannot fix errors.',
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
    notesContentGuidance,
    notesProseGuidance,
    'Group useful sections by topic. Put each accepted responsibility in an action item rather than only the overview; code derives document rollups.',
    notesSourceGuidance,
    '',
    `Known terminology hints (entity hints are not trusted corrections): ${termsPacket(knownTerms)}`,
    getTemplateGuidance(template),
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
  maxSourceSpans = 3,
}: WriterPromptInput): string =>
  [
    notesContentGuidance,
    notesProseGuidance,
    'Group useful sections by topic. Put each accepted responsibility in an action item rather than only the overview.',
    notesSourceGuidance,
    '',
    `Known terminology hints (entity hints are not trusted corrections): ${termsPacket(knownTerms)}`,
    getTemplateGuidance(template),
    'User-note emphasis:',
    userNotes,
    '',
    sourcePacket(sourceText),
    '',
    'Return compact JSON only using these fields:',
    compactNotesDraftSchema.replaceAll(
      'at most 3',
      `at most ${maxSourceSpans}`,
    ),
  ].join('\n');

export const buildNotesAuditPrompt = ({
  sourceText,
  draft,
  inherited,
  userNotes,
  knownTerms,
  template,
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
    getTemplateGuidance(template),
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
    getTemplateGuidance(template),
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
