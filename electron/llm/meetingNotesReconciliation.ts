import { acceptEditedNotes, parseNotesDraft } from './meetingNotesAudit';
import { findNotesGuardrailIssues } from './meetingNotesGuardrails';
import {
  notesContentGuidance,
  notesSourceFirstGuidance,
  notesSourceGuidance,
} from './meetingNotesGuidance';
import {
  MeetingNotesError,
  type NotesDraft,
  type NotesItem,
  type NotesSource,
  type SourceSpan,
} from './meetingNotesTypes';

type ReconciledText = {
  readonly id: string;
  readonly text: string;
  readonly sources: readonly Readonly<SourceSpan>[];
};

export type ReconciledSource = {
  readonly facts: readonly ReconciledText[];
  readonly actions: readonly (ReconciledText & {
    readonly owner: string | null;
    readonly due: string | null;
  })[];
  readonly decisions: readonly (ReconciledText & {
    readonly owner: string | null;
  })[];
  readonly questions: readonly ReconciledText[];
};

export const buildSourceReconciliationPrompt = (
  sourceText: string,
  sourceFirstReconciliation = false,
): string =>
  [
    'Reconcile original source, not meeting notes. Attribute facts where relevant; put discussion in facts. Do not invent ids, headings, overview or filler.',
    notesContentGuidance,
    ...(sourceFirstReconciliation ? [notesSourceFirstGuidance] : []),
    notesSourceGuidance,
    'Return compact JSON with exactly four arrays: {facts: Text[], actions: Action[], decisions: Decision[], questions: Text[]}. Empty shape: {"facts":[],"actions":[],"decisions":[],"questions":[]}.',
    'Field definitions, not content: Text = {text: nonempty string, sources: copied source descriptor[]}; Action = {text: nonempty string, sources: copied source descriptor[], owner: string | null, due: string | null}; Decision = {text: nonempty string, sources: copied source descriptor[], owner: string | null}. Use null for unknown metadata.',
    'BEGIN SOURCE DATA',
    sourceText,
    'END SOURCE DATA',
  ].join('\n');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const categories = ['facts', 'actions', 'decisions', 'questions'] as const;

const invalid = (): never => {
  throw new MeetingNotesError('notes_reconciliation_invalid');
};

const parseEntries = (
  values: unknown[],
  category: (typeof categories)[number],
  applicationIdPrefix: string,
) =>
  values.map((value, index) => {
    if (!isRecord(value)) return invalid();
    const metadata =
      category === 'actions'
        ? ['owner', 'due']
        : category === 'decisions'
          ? ['owner']
          : [];
    const allowed = ['id', 'text', 'sources', ...metadata];
    if (
      typeof value.text !== 'string' ||
      !Array.isArray(value.sources) ||
      value.sources.some(
        (span) =>
          !isRecord(span) ||
          Object.keys(span).some(
            (key) => !['segment', 'start', 'end'].includes(key),
          ),
      ) ||
      Object.keys(value).some((key) => !allowed.includes(key)) ||
      metadata.some(
        (key) =>
          value[key] !== null &&
          (typeof value[key] !== 'string' || !(value[key] as string).trim()),
      )
    )
      return invalid();
    // The shared draft parser checks text and descriptor structure below;
    // acceptEditedNotes then resolves every descriptor against the original.
    return {
      id: `${applicationIdPrefix}:${category}:${index}`,
      text: value.text,
      sources: value.sources as SourceSpan[],
      ...(category === 'actions' || category === 'decisions'
        ? { owner: value.owner as string | null }
        : {}),
      ...(category === 'actions' ? { due: value.due as string | null } : {}),
    };
  });

export const parseReconciledSource = (
  raw: string,
  source: NotesSource,
  allowedSpans?: readonly SourceSpan[],
  applicationIdPrefix = 'reconciled',
): ReconciledSource => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length !== categories.length ||
    categories.some((key) => !Array.isArray(parsed[key]))
  )
    return invalid();
  const result = Object.fromEntries(
    categories.map((category) => [
      category,
      parseEntries(
        parsed[category] as unknown[],
        category,
        applicationIdPrefix,
      ),
    ]),
  ) as unknown as ReconciledSource;

  if (
    allowedSpans &&
    Object.values(result).some((entries) =>
      entries.some((entry) =>
        entry.sources.some(
          (span) =>
            !allowedSpans.some(
              (allowed) =>
                allowed.segment === span.segment &&
                allowed.start <= span.start &&
                allowed.end >= span.end,
            ),
        ),
      ),
    )
  ) {
    throw new MeetingNotesError('notes_reconciliation_source_out_of_scope');
  }

  // Validate the mechanical draft, not the normalized/owner-filled review copy.
  // Source checks are narrow commitment safeguards, not general semantic truth.
  // Discard the reviewed copy: it can normalize prose or infer missing owners.
  const draft = reconciliationDraft(result);
  acceptEditedNotes({
    source,
    draft: parseNotesDraft(JSON.stringify(draft)),
  });
  const issues = findNotesGuardrailIssues(source, draft, allowedSpans);
  if (issues.length) {
    throw new MeetingNotesError(`notes_guardrail:${JSON.stringify(issues)}`);
  }
  for (const entries of Object.values(result)) {
    for (const entry of entries) {
      for (const span of entry.sources) Object.freeze(span);
      Object.freeze(entry.sources);
      Object.freeze(entry);
    }
    Object.freeze(entries);
  }
  return Object.freeze(result);
};

/** Mechanical inspection shape, not composed notes or a semantic audit. */
export const reconciliationDraft = (result: ReconciledSource): NotesDraft => {
  const items: NotesItem[] = categories.flatMap((category) =>
    result[category].map((entry) => ({
      id: entry.id,
      text: entry.text,
      sources: entry.sources.map((span) => ({ ...span })),
      kind: (
        {
          facts: 'point',
          actions: 'action',
          decisions: 'decision',
          questions: 'question',
        } as const
      )[category],
      owner: 'owner' in entry ? entry.owner : null,
      due: 'due' in entry ? entry.due : null,
    })),
  );
  const sources = [
    ...new Map(
      items
        .flatMap((item) => item.sources)
        .map((span) => [
          `${span.segment}:${span.start}:${span.end}`,
          { ...span },
        ]),
    ).values(),
  ];
  return {
    meetingType: 'general',
    overview: null,
    sections: items.length
      ? [
          {
            id: 'reconciled',
            title: { id: 'reconciled:title', text: 'Conversation', sources },
            items,
          },
        ]
      : [],
  };
};
