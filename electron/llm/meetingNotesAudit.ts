import {
  groundRecentWin,
  groundSourceReviewedItem,
  isUnacceptedConditionalWillingness,
  normalizeTranscriptEvidence,
} from './analysisGrounding';
import type {
  AnalysisDocumentV3,
  MeetingTerminologyArtifactV1,
} from './analysisTypes';
import { createEditorTerminologyArtifact } from './meetingNotesEditorTerminology';
import { resolveSourceSpan } from './meetingNotesSource';
import {
  type AuditVerdict,
  MeetingNotesError,
  NOTES_PROMPT_VERSION,
  type NotesAudit,
  type NotesDraft,
  type NotesItem,
  type NotesSection,
  type NotesSource,
  type SourceSpan,
  type SupportedText,
} from './meetingNotesTypes';
import {
  type RawTerminologyProposal,
  type TerminologyCandidateCluster,
  createTerminologyArtifact,
  getAppliedTerminologyAliases,
} from './terminologyReconciliation';

export type AuditedNotes = {
  source: NotesSource;
  draft: NotesDraft;
  verdicts: ReadonlyMap<string, AuditVerdict>;
  acceptedTerminology: NotesAudit['terminology'];
  terminologyArtifact?: MeetingTerminologyArtifactV1;
  issues?: string[];
};

type Block = SupportedText | NotesItem;
const reviewedResults = new WeakSet<object>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

const parseSpan = (value: unknown): SourceSpan | null => {
  if (!isRecord(value)) return null;
  const { segment, start, end } = value;
  return Number.isInteger(segment) &&
    Number.isInteger(start) &&
    Number.isInteger(end)
    ? { segment: segment as number, start: start as number, end: end as number }
    : null;
};

const parseSupportedText = (
  value: unknown,
  assignedId?: string,
): SupportedText | null => {
  const id =
    assignedId ??
    (isSafeId((value as { id?: unknown })?.id)
      ? (value as { id: string }).id
      : null);
  if (!isRecord(value) || !id || typeof value.text !== 'string') {
    return null;
  }
  const text = value.text.trim();
  if (!text || text.length > 12_000 || !Array.isArray(value.sources))
    return null;
  const sources = value.sources.map(parseSpan);
  if (sources.some((source) => source === null) || sources.length === 0)
    return null;
  return { id, text, sources: sources as SourceSpan[] };
};

const parseItem = (value: unknown, assignedId?: string): NotesItem | null => {
  const supported = parseSupportedText(value, assignedId);
  if (!supported || !isRecord(value)) return null;
  if (
    !['point', 'action', 'decision', 'question'].includes(String(value.kind))
  ) {
    return null;
  }
  const nullableString = (field: unknown): string | null =>
    field === null
      ? null
      : typeof field === 'string' && field.trim()
        ? field.trim()
        : null;
  const narrative = value.kind === 'point' || value.kind === 'question';
  if (
    !(narrative && value.owner === undefined) &&
    value.owner !== null &&
    typeof value.owner !== 'string'
  )
    return null;
  if (
    !(narrative && value.due === undefined) &&
    value.due !== null &&
    typeof value.due !== 'string'
  )
    return null;
  return {
    ...supported,
    kind: value.kind as NotesItem['kind'],
    owner: nullableString(value.owner),
    due: nullableString(value.due),
  };
};

const parseSection = (value: unknown): NotesSection | null => {
  if (!isRecord(value) || !isSafeId(value.id)) return null;
  const title = parseSupportedText(value.title);
  if (!title || !Array.isArray(value.items)) return null;
  const items = value.items.map((item) => parseItem(item));
  if (items.some((item) => item === null)) return null;
  return { id: value.id, title, items: items as NotesItem[] };
};

const parseWriterSection = (
  value: unknown,
  index: number,
): NotesSection | null => {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const id = `s${index}`;
  const title = parseSupportedText(value.title, `${id}:title`);
  const items = value.items.map((item, itemIndex) => {
    if (
      isRecord(item) &&
      Array.isArray(item.sources) &&
      item.sources.length === 0
    ) {
      throw new MeetingNotesError(
        `notes_writer_invalid:${id}:item:${itemIndex}:missing_source`,
      );
    }
    return parseItem(item, `${id}:item:${itemIndex}`);
  });
  if (!title || items.some((item) => item === null)) return null;
  return { id, title, items: items as NotesItem[] };
};

const parseRecentWin = (value: unknown): NotesDraft['recentWin'] | null => {
  if (!isRecord(value)) return null;
  const win = parseSupportedText(value.win, 'recent-win');
  const impact = parseSupportedText(value.impact, 'recent-win-impact');
  return win && impact ? { win, impact } : null;
};

export const parseNotesDraft = (raw: string): NotesDraft => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.sections)) {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  const meetingType = parsed.meetingType;
  if (
    ![
      'one_on_one',
      'team_sync',
      'brainstorm',
      'presentation',
      'general',
    ].includes(String(meetingType))
  ) {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  const overview =
    parsed.overview === null
      ? null
      : parseSupportedText(parsed.overview, 'overview');
  const sections = parsed.sections.map(parseWriterSection);
  const noRecentWin =
    parsed.recentWin === undefined ||
    parsed.recentWin === null ||
    (isRecord(parsed.recentWin) &&
      parsed.recentWin.win === null &&
      parsed.recentWin.impact === null);
  const recentWin = noRecentWin ? undefined : parseRecentWin(parsed.recentWin);
  if (
    (parsed.overview !== null && !overview) ||
    (!noRecentWin && !recentWin) ||
    sections.some((section) => section === null) ||
    sections.length > 64
  ) {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  return {
    meetingType: meetingType as NotesDraft['meetingType'],
    overview,
    sections: sections as NotesSection[],
    ...(recentWin ? { recentWin } : {}),
  };
};

export const parseNotesAudit = (raw: string): NotesAudit => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MeetingNotesError('notes_audit_invalid');
  }
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.changes) ||
    !Array.isArray(parsed.verdicts) ||
    !Array.isArray(parsed.dispositions) ||
    !Array.isArray(parsed.terminology)
  ) {
    throw new MeetingNotesError('notes_audit_invalid');
  }
  const invalidChange = parsed.changes.some(
    (change) =>
      !isRecord(change) ||
      !['replace', 'remove', 'insert', 'insert_section'].includes(
        String(change.op),
      ),
  );
  const invalidVerdict = parsed.verdicts.some(
    (verdict) =>
      !isRecord(verdict) ||
      !isSafeId(verdict.target) ||
      !['supported', 'uncertain', 'unsupported'].includes(
        String(verdict.status),
      ) ||
      !Array.isArray(verdict.sources) ||
      verdict.sources.some((source) => parseSpan(source) === null),
  );
  const invalidDisposition = parsed.dispositions.some(
    (disposition) =>
      !isRecord(disposition) ||
      !isSafeId(disposition.target) ||
      !['deduplicated', 'cancelled', 'superseded'].includes(
        String(disposition.kind),
      ) ||
      (disposition.kind === 'deduplicated' &&
        !isSafeId(disposition.replacementId)) ||
      (disposition.replacementId !== null &&
        !isSafeId(disposition.replacementId)) ||
      !Array.isArray(disposition.sources) ||
      disposition.sources.length === 0 ||
      disposition.sources.some((source) => parseSpan(source) === null),
  );
  const invalidTerminology = parsed.terminology.some(
    (proposal) =>
      !isRecord(proposal) ||
      !Array.isArray(proposal.rawForms) ||
      proposal.rawForms.some((form) => typeof form !== 'string') ||
      (proposal.preferredTerm !== null &&
        typeof proposal.preferredTerm !== 'string') ||
      !Array.isArray(proposal.segmentIndexes) ||
      proposal.segmentIndexes.some(
        (index) => !Number.isInteger(index) || index < 0,
      ) ||
      !['high', 'medium', 'low'].includes(String(proposal.confidence)) ||
      !Array.isArray(proposal.signals) ||
      proposal.signals.some((signal) => typeof signal !== 'string'),
  );
  if (
    invalidChange ||
    invalidVerdict ||
    invalidDisposition ||
    invalidTerminology
  ) {
    throw new MeetingNotesError('notes_audit_invalid');
  }
  return parsed as unknown as NotesAudit;
};

const blocksForDraft = (draft: NotesDraft): Block[] => [
  ...(draft.overview ? [draft.overview] : []),
  ...draft.sections.flatMap((section) => [section.title, ...section.items]),
  ...(draft.recentWin ? [draft.recentWin.win, draft.recentWin.impact] : []),
];

const validateSources = (source: NotesSource, spans: SourceSpan[]) => {
  if (!spans.length) throw new MeetingNotesError('invalid_notes_audit');
  for (const span of spans) resolveSourceSpan(source, span);
};

const removeBlock = (draft: NotesDraft, target: string): boolean => {
  if (draft.overview?.id === target) {
    draft.overview = null;
    return true;
  }
  if (
    draft.recentWin?.win.id === target ||
    draft.recentWin?.impact.id === target
  ) {
    draft.recentWin = undefined;
    return true;
  }
  for (const section of draft.sections) {
    if (section.title.id === target) {
      draft.sections = draft.sections.filter((entry) => entry !== section);
      return true;
    }
    const index = section.items.findIndex((item) => item.id === target);
    if (index >= 0) {
      section.items.splice(index, 1);
      return true;
    }
  }
  return false;
};

const replaceBlock = (
  draft: NotesDraft,
  target: string,
  value: Block,
): boolean => {
  if (draft.overview?.id === target && !('kind' in value)) {
    draft.overview = value;
    return true;
  }
  if (draft.recentWin?.win.id === target && !('kind' in value)) {
    draft.recentWin.win = value;
    return true;
  }
  if (draft.recentWin?.impact.id === target && !('kind' in value)) {
    draft.recentWin.impact = value;
    return true;
  }
  for (const section of draft.sections) {
    if (section.title.id === target && !('kind' in value)) {
      section.title = value;
      return true;
    }
    const index = section.items.findIndex((item) => item.id === target);
    if (index >= 0 && 'kind' in value) {
      section.items[index] = value;
      return true;
    }
  }
  return false;
};

const sourceText = (source: NotesSource, spans: SourceSpan[]): string => {
  const seen = new Set<string>();
  return spans
    .filter((span) => {
      const key = `${span.segment}:${span.start}:${span.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((span) => resolveSourceSpan(source, span))
    .join(' ');
};

const transcriptForSource = (source: NotesSource): string =>
  source.segments
    .filter((segment) => segment.text.trim())
    .map((segment) => `${segment.speaker ?? 'Speaker'}: ${segment.text}`)
    .join('\n');

const overviewForDraft = (draft: NotesDraft): SupportedText | null => {
  if (draft.overview) return draft.overview;
  // Sample across topics before adding detail. Prefer each topic's first
  // reviewed outcome over an earlier offer, keeping narrative-only topics.
  const firstItems = draft.sections.flatMap((section) => {
    const first =
      section.items.find(
        (item) => item.kind === 'decision' || item.kind === 'action',
      ) ?? section.items[0];
    return first ? [first] : [];
  });
  const selectedIds = new Set(firstItems.map((item) => item.id));
  const remainingItems = draft.sections.flatMap((section) =>
    section.items.filter((item) => !selectedIds.has(item.id)),
  );
  const items = [...firstItems, ...remainingItems].slice(0, 3);
  return items.length
    ? {
        id: 'derived-overview',
        text: items.map((item) => item.text).join(' '),
        sources: items.flatMap((item) => item.sources),
      }
    : null;
};

const sourceMetadata = (draft: NotesDraft) => {
  const blocks: Record<
    string,
    {
      id: string;
      sources: Array<{ segment: number; start: number; end: number }>;
    }
  > = {};
  const add = (path: string, block: Block) => {
    blocks[path] = { id: block.id, sources: block.sources };
  };
  const addEditable = (
    path: string,
    block: Block,
    supportsCompletion = false,
  ) => {
    add(path, block);
    blocks[`native_continuations:${path}`] = {
      id: block.id,
      sources: block.sources,
    };
    if (supportsCompletion) {
      blocks[`completion:${path}`] = {
        id: block.id,
        sources: block.sources,
      };
    }
  };

  const overview = overviewForDraft(draft);
  if (overview) add('overview', overview);
  if (draft.recentWin) {
    add('recent_win:win', draft.recentWin.win);
    add('recent_win:why_it_counts', draft.recentWin.impact);
  }

  let actionIndex = 0;
  let decisionIndex = 0;
  draft.sections.forEach((section, sectionIndex) => {
    add(`topic:${sectionIndex}:title`, section.title);
    let pointIndex = 0;
    let questionIndex = 0;
    let topicActionIndex = 0;
    let topicDecisionIndex = 0;
    for (const item of section.items) {
      if (item.kind === 'point') {
        const path =
          pointIndex === 0
            ? `topic:${sectionIndex}:summary`
            : `topic:${sectionIndex}:point:${pointIndex - 1}`;
        addEditable(path, item);
        pointIndex += 1;
        continue;
      }
      if (item.kind === 'question') {
        addEditable(`topic:${sectionIndex}:question:${questionIndex}`, item);
        questionIndex += 1;
        continue;
      }
      if (item.kind === 'action') {
        add(`topic:${sectionIndex}:action:${topicActionIndex}`, item);
        addEditable(`all_action_items:${actionIndex}`, item, true);
        topicActionIndex += 1;
        actionIndex += 1;
        continue;
      }
      add(`topic:${sectionIndex}:decision:${topicDecisionIndex}`, item);
      addEditable(`all_decisions:${decisionIndex}`, item, true);
      topicDecisionIndex += 1;
      decisionIndex += 1;
    }
  });
  return blocks;
};

type AuditTerminologyContext = {
  trustedUserTerms: string[];
  provider: string;
  model: string;
};

const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

const terminologyCandidatesFor = (
  source: NotesSource,
  draft: NotesDraft,
  audit: NotesAudit,
): TerminologyCandidateCluster[] => {
  const referencedSegments = new Set(
    [...blocksForDraft(draft), ...audit.verdicts, ...audit.dispositions]
      .flatMap((entry) => entry.sources)
      .map((span) => span.segment),
  );
  return audit.terminology.flatMap((proposal) => {
    if (!isRecord(proposal)) return [];
    const rawForms = Array.isArray(proposal.rawForms)
      ? uniqueStrings(
          proposal.rawForms.filter(
            (form): form is string =>
              typeof form === 'string' &&
              form.trim().length >= 2 &&
              form.trim().length <= 80 &&
              !/[\r\n]/.test(form),
          ),
        )
      : [];
    const segmentIndexes = Array.isArray(proposal.segmentIndexes)
      ? uniqueStrings(
          proposal.segmentIndexes
            .filter(
              (index): index is number =>
                Number.isInteger(index) && referencedSegments.has(index),
            )
            .map(String),
        ).map(Number)
      : [];
    const segments = segmentIndexes
      .map((index) =>
        source.segments.find((segment) => segment.index === index),
      )
      .filter((segment): segment is NotesSource['segments'][number] =>
        Boolean(segment),
      );
    if (
      rawForms.length === 0 ||
      segments.length === 0 ||
      !rawForms.some((form) =>
        segments.some((segment) =>
          segment.text.toLocaleLowerCase().includes(form.toLocaleLowerCase()),
        ),
      )
    ) {
      return [];
    }
    return [
      {
        rawForms,
        segmentIndexes,
        contexts: segments.map(
          (segment) => `${segment.speaker ?? 'Speaker'}: ${segment.text}`,
        ),
        kind: 'domain_term' as const,
        reasons: ['ambiguous' as const],
      },
    ];
  });
};

const terminologyArtifactFor = (
  source: NotesSource,
  draft: NotesDraft,
  audit: NotesAudit,
  context: AuditTerminologyContext | undefined,
): MeetingTerminologyArtifactV1 | undefined => {
  if (!context || audit.terminology.length === 0) return undefined;
  const candidates = terminologyCandidatesFor(source, draft, audit);
  if (candidates.length === 0) return undefined;
  const proposals: RawTerminologyProposal[] = audit.terminology.flatMap(
    (proposal) =>
      isRecord(proposal)
        ? [
            {
              raw_forms: proposal.rawForms,
              preferred_term: proposal.preferredTerm,
              confidence: proposal.confidence,
              signals: proposal.signals,
            },
          ]
        : [],
  );
  return createTerminologyArtifact({
    candidates,
    proposals,
    knownTerms: context.trustedUserTerms,
    provider: context.provider,
    model: context.model,
    generatedAt: new Date().toISOString(),
  });
};

const replaceTerminologyAliases = (
  text: string,
  aliases: Record<string, string[]>,
): string => {
  let result = text;
  for (const [preferred, rawForms] of Object.entries(aliases)) {
    for (const rawForm of [...rawForms].sort(
      (left, right) => right.length - left.length,
    )) {
      const escaped = rawForm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`\\b${escaped}\\b`, 'giu'), preferred);
    }
  }
  return result;
};

const applyTerminologyToProse = (
  analysis: AnalysisDocumentV3,
  artifact: MeetingTerminologyArtifactV1 | undefined,
): AnalysisDocumentV3 => {
  if (!artifact) return analysis;
  const metadata = analysis.generation_metadata;
  if (!metadata) return analysis;
  const aliases = getAppliedTerminologyAliases(artifact);
  if (Object.keys(aliases).length === 0) {
    return {
      ...analysis,
      generation_metadata: {
        ...metadata,
        terminology: artifact,
      },
    };
  }
  const topics = analysis.topics.map((topic) => ({
    ...topic,
    title: replaceTerminologyAliases(topic.title, aliases),
    summary: replaceTerminologyAliases(topic.summary, aliases),
    key_points: topic.key_points.map((point) => ({
      ...point,
      text: replaceTerminologyAliases(point.text, aliases),
    })),
    decisions: topic.decisions.map((decision) => ({
      ...decision,
      text: replaceTerminologyAliases(decision.text, aliases),
      ...(decision.rationale
        ? { rationale: replaceTerminologyAliases(decision.rationale, aliases) }
        : {}),
    })),
    action_items: topic.action_items.map((item) => ({
      ...item,
      text: replaceTerminologyAliases(item.text, aliases),
    })),
    open_questions: topic.open_questions.map((question) =>
      replaceTerminologyAliases(question, aliases),
    ),
  }));
  return {
    ...analysis,
    overview: replaceTerminologyAliases(analysis.overview, aliases),
    topics,
    all_action_items: topics.flatMap((topic) =>
      topic.action_items.map((item) => ({ ...item, topic: topic.title })),
    ),
    all_decisions: topics.flatMap((topic) => topic.decisions),
    ...(analysis.recent_win
      ? {
          recent_win: {
            ...analysis.recent_win,
            win: replaceTerminologyAliases(analysis.recent_win.win, aliases),
            why_it_counts: replaceTerminologyAliases(
              analysis.recent_win.why_it_counts,
              aliases,
            ),
          },
        }
      : {}),
    generation_metadata: {
      ...metadata,
      terminology: artifact,
    },
  };
};

export const applyNotesAudit = ({
  source,
  draft,
  audit,
  terminology,
  qualityPolicy = 'strict',
  allowedSources,
  inherited = [],
}: {
  source: NotesSource;
  draft: NotesDraft;
  audit: NotesAudit;
  terminology?: AuditTerminologyContext;
  qualityPolicy?: 'strict' | 'advisory';
  allowedSources?: SourceSpan[];
  inherited?: NotesItem[];
}): AuditedNotes => {
  const issues: string[] = [];
  const checkSources = (spans: SourceSpan[]) => {
    validateSources(source, spans);
    if (
      allowedSources &&
      spans.some(
        (span) =>
          !allowedSources.some(
            (allowed) =>
              allowed.segment === span.segment &&
              allowed.start === span.start &&
              allowed.end === span.end,
          ),
      )
    )
      throw new MeetingNotesError('invalid_notes_audit');
  };
  const next = structuredClone(draft);
  for (const proposal of allowedSources ? audit.terminology : []) {
    if (
      proposal.segmentIndexes.some(
        (index) =>
          !source.segments.some((segment) => segment.index === index) ||
          (allowedSources &&
            !allowedSources.some((span) => span.segment === index)),
      )
    )
      throw new MeetingNotesError('invalid_notes_audit');
  }
  const initialIds = new Set(blocksForDraft(next).map((block) => block.id));
  if (initialIds.size !== blocksForDraft(next).length) {
    throw new MeetingNotesError('invalid_notes_audit');
  }
  for (const block of blocksForDraft(next)) checkSources(block.sources);

  const verdicts = new Map<string, AuditVerdict>();
  for (const verdict of audit.verdicts) {
    if (
      !isSafeId(verdict.target) ||
      verdicts.has(verdict.target) ||
      !['supported', 'uncertain', 'unsupported'].includes(verdict.status)
    ) {
      throw new MeetingNotesError('invalid_notes_audit');
    }
    checkSources(verdict.sources);
    verdicts.set(verdict.target, structuredClone(verdict));
  }

  const changedTargets = new Set<string>();
  for (const change of audit.changes) {
    if (!isRecord(change) || typeof change.op !== 'string') {
      throw new MeetingNotesError('invalid_notes_audit');
    }
    if (change.op === 'remove') {
      if (
        !isSafeId(change.target) ||
        changedTargets.has(change.target) ||
        !removeBlock(next, change.target)
      ) {
        throw new MeetingNotesError('invalid_notes_audit');
      }
      changedTargets.add(change.target);
      continue;
    }
    if (change.op === 'replace') {
      const value =
        parseItem(change.value, change.target) ??
        parseSupportedText(change.value, change.target);
      if (
        !isSafeId(change.target) ||
        changedTargets.has(change.target) ||
        !value ||
        !replaceBlock(next, change.target, value)
      ) {
        throw new MeetingNotesError('invalid_notes_audit');
      }
      checkSources(value.sources);
      changedTargets.add(change.target);
      continue;
    }
    if (change.op === 'insert') {
      const value = parseItem(change.value);
      const section = next.sections.find(
        (entry) => entry.id === change.section,
      );
      if (
        !isSafeId(change.section) ||
        !section ||
        !value ||
        blocksForDraft(next).some((block) => block.id === value.id)
      ) {
        throw new MeetingNotesError('invalid_notes_audit');
      }
      checkSources(value.sources);
      section.items.push(value);
      continue;
    }
    if (change.op === 'insert_section') {
      const section = parseSection(change.value);
      if (
        !section ||
        next.sections.some((entry) => entry.id === section.id) ||
        blocksForDraft(next).some((block) =>
          [section.title, ...section.items].some(
            (candidate) => candidate.id === block.id,
          ),
        )
      ) {
        throw new MeetingNotesError('invalid_notes_audit');
      }
      checkSources(section.title.sources);
      section.items.forEach((item) => checkSources(item.sources));
      next.sections.push(section);
      continue;
    }
    throw new MeetingNotesError('invalid_notes_audit');
  }

  // Complete contract validation precedes semantic removal. In particular, a
  // rejected heading must not hide a missing child verdict or invalid reference.
  const finalBlocks = blocksForDraft(next);
  const knownIds = new Set([
    ...initialIds,
    ...finalBlocks.map((block) => block.id),
    ...inherited.map((item) => item.id),
  ]);
  for (const verdict of verdicts.values()) {
    if (!knownIds.has(verdict.target))
      throw new MeetingNotesError('invalid_notes_audit');
  }
  for (const block of finalBlocks) {
    if (!verdicts.has(block.id))
      throw new MeetingNotesError(`notes_audit_missing_verdict:${block.id}`);
  }
  const dispositionTargets = new Set<string>();
  for (const disposition of audit.dispositions) {
    checkSources(disposition.sources);
    if (
      !knownIds.has(disposition.target) ||
      dispositionTargets.has(disposition.target) ||
      (disposition.replacementId !== null &&
        !finalBlocks.some((block) => block.id === disposition.replacementId))
    ) {
      throw new MeetingNotesError('invalid_notes_audit');
    }
    dispositionTargets.add(disposition.target);
  }
  for (const section of next.sections) {
    if (
      verdicts.get(section.title.id)?.status === 'unsupported' &&
      section.items.some(
        (item) => verdicts.get(item.id)?.status !== 'unsupported',
      )
    ) {
      // Reject an incoherent audit instead of losing supported content as a side
      // effect of deleting its heading. The bounded repair must correct the title.
      throw new MeetingNotesError(
        `notes_audit_unsupported_title:${section.title.id}:replace_heading_or_review_children`,
      );
    }
  }
  for (const block of blocksForDraft(next)) {
    const verdict = verdicts.get(block.id);
    if (!verdict)
      throw new MeetingNotesError(`notes_audit_missing_verdict:${block.id}`);
    block.sources = structuredClone(verdict.sources);
    if (verdict.status === 'unsupported') {
      removeBlock(next, block.id);
    } else if (
      verdict.status === 'uncertain' &&
      'kind' in block &&
      (block.kind === 'action' || block.kind === 'decision')
    ) {
      removeBlock(next, block.id);
    } else if (verdict.status === 'uncertain') {
      block.text = `Unconfirmed: ${block.text}`;
    }
  }

  for (const section of next.sections) {
    section.items = section.items.flatMap((item) => {
      if (item.kind !== 'action' && item.kind !== 'decision') return [item];
      const evidence = sourceText(source, item.sources);
      const sourceLines = item.sources.map((span) => {
        const segment = source.segments.find(
          (entry) => entry.index === span.segment,
        )!;
        return `${segment.speaker ?? 'Speaker'}: ${resolveSourceSpan(source, span)}`;
      });
      const checked = groundSourceReviewedItem(
        { ...item, kind: item.kind },
        {
          evidence,
          quotedEvidence: evidence,
          sourceLines,
          sourceLine: sourceLines.join(' '),
          lineIndex: item.sources[0]!.segment,
        },
      );
      // A supported verdict and a failed source check require repair, not a
      // clean publication with the disputed material silently deleted.
      if (!checked) {
        if (qualityPolicy === 'advisory') {
          issues.push(`notes_audit_invalid_commitment:${item.id}`);
          return [];
        }
        throw new MeetingNotesError(
          `notes_audit_invalid_commitment:${item.id}:correct_wording_or_kind_from_source`,
        );
      }
      return [{ ...item, ...checked }];
    });
  }

  const result: AuditedNotes = {
    source,
    draft: next,
    verdicts,
    acceptedTerminology: structuredClone(audit.terminology),
    issues,
    ...(terminology
      ? {
          terminologyArtifact: terminologyArtifactFor(
            source,
            next,
            audit,
            terminology,
          ),
        }
      : {}),
  };
  reviewedResults.add(result);
  return result;
};

/** Complete-document source review uses the same provenance and projection boundary,
 * without pretending the editor returned per-block audit verdicts. Invalid settled
 * claims fail the review; they must not silently erase otherwise useful discussion. */
export const acceptEditedNotes = ({
  source,
  draft,
  terminology,
  proposals = [],
  acceptancePolicy = 'strict',
}: {
  source: NotesSource;
  draft: NotesDraft;
  terminology?: AuditTerminologyContext;
  proposals?: NotesAudit['terminology'];
  acceptancePolicy?: 'strict' | 'conservative';
}): AuditedNotes => {
  const next = structuredClone(draft);
  const issues: string[] = [];
  for (const block of blocksForDraft(next)) {
    validateSources(source, block.sources);
    const evidence = sourceText(source, block.sources);
    if (
      (block.text.match(/\bR\d+\b/g) ?? []).some(
        (label) => !evidence.includes(label),
      )
    ) {
      throw new MeetingNotesError(`notes_editor_source_label:${block.id}`);
    }
  }
  for (const section of next.sections) {
    section.items = section.items.flatMap((item) => {
      if (item.kind !== 'action' && item.kind !== 'decision') return [item];
      const evidence = sourceText(source, item.sources);
      if (
        item.kind === 'action' &&
        isUnacceptedConditionalWillingness(evidence)
      ) {
        throw new MeetingNotesError(
          `notes_editor_invalid_commitment:${item.id}:conditional_willingness_is_not_accepted__change_kind_to_point_and_preserve_can_or_could_not_will_in_text`,
        );
      }
      const sourceLines = item.sources.map((span) => {
        const segment = source.segments.find(
          (entry) => entry.index === span.segment,
        )!;
        return `${segment.speaker ?? 'Speaker'}: ${resolveSourceSpan(source, span)}`;
      });
      const checked = groundSourceReviewedItem(
        { ...item, kind: item.kind },
        {
          evidence,
          quotedEvidence: evidence,
          sourceLines,
          sourceLine: sourceLines.join(' '),
          lineIndex: item.sources[0]!.segment,
        },
      );
      if (!checked) {
        if (acceptancePolicy === 'conservative') {
          issues.push(`deterministic_unsupported_commitment:${item.id}`);
          return [];
        }
        throw new MeetingNotesError(
          `notes_editor_invalid_commitment:${item.id}:correct_wording_kind_owner_or_due_from_source`,
        );
      }
      const ownerChanged =
        Boolean(item.owner) &&
        normalizeTranscriptEvidence(item.owner ?? '') !==
          normalizeTranscriptEvidence(checked.owner ?? '');
      const dueRemoved = Boolean(item.due) && !checked.due;
      if (acceptancePolicy === 'strict' && (ownerChanged || dueRemoved)) {
        throw new MeetingNotesError(
          `notes_editor_invalid_commitment:${item.id}:correct_wording_kind_owner_or_due_from_source`,
        );
      }
      if (ownerChanged) issues.push(`deterministic_corrected_owner:${item.id}`);
      if (dueRemoved) issues.push(`deterministic_removed_due:${item.id}`);
      return [{ ...item, ...checked }];
    });
  }
  const result: AuditedNotes = {
    source,
    draft: next,
    verdicts: new Map(),
    acceptedTerminology: structuredClone(proposals),
    ...(issues.length ? { issues } : {}),
    ...(terminology
      ? {
          terminologyArtifact: createEditorTerminologyArtifact({
            source,
            draft: next,
            proposals,
            context: terminology,
          }),
        }
      : {}),
  };
  reviewedResults.add(result);
  return result;
};

export const projectAuditedNotes = (
  audited: AuditedNotes,
): AnalysisDocumentV3 => {
  if (!reviewedResults.has(audited))
    throw new MeetingNotesError('notes_unreviewed_projection');
  const topics = audited.draft.sections
    .filter((section) => section.items.length > 0)
    .map((section) => {
      const points = section.items.filter((item) => item.kind === 'point');
      const actions = section.items
        .filter((item) => item.kind === 'action')
        .map((item) => ({
          text: item.text,
          ...(item.owner ? { assignee: item.owner } : {}),
          ...(item.due ? { due: item.due } : {}),
          evidence: sourceText(audited.source, item.sources),
        }));
      const decisions = section.items
        .filter((item) => item.kind === 'decision')
        .map((item) => ({
          text: item.text,
          ...(item.owner ? { decided_by: item.owner } : {}),
          evidence: sourceText(audited.source, item.sources),
        }));
      return {
        title: section.title.text,
        summary: points[0]?.text ?? '',
        key_points: points.slice(1).map((point) => ({ text: point.text })),
        decisions,
        action_items: actions,
        open_questions: section.items
          .filter((item) => item.kind === 'question')
          .map((item) => item.text),
      };
    });
  const overview =
    overviewForDraft(audited.draft)?.text ?? 'Conversation captured.';
  const analysis: AnalysisDocumentV3 = {
    analysis_schema_version: 3,
    overview,
    topics,
    all_action_items: topics.flatMap((topic) =>
      topic.action_items.map((item) => ({ ...item, topic: topic.title })),
    ),
    all_decisions: topics.flatMap((topic) => topic.decisions),
    ...(audited.draft.recentWin
      ? {
          recent_win: {
            win: audited.draft.recentWin.win.text,
            why_it_counts: audited.draft.recentWin.impact.text,
            evidence: sourceText(audited.source, [
              ...audited.draft.recentWin.win.sources,
              ...audited.draft.recentWin.impact.sources,
            ]),
          },
        }
      : {}),
    meeting_type: audited.draft.meetingType,
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [...(audited.issues ?? [])],
    },
    generation_metadata: {
      provider: 'ollama',
      model: 'source-grounded',
      generation_path: 'single_pass',
      prompt_version: NOTES_PROMPT_VERSION,
      generated_at: new Date().toISOString(),
      error_categories: audited.issues?.length ? ['notes_quality_warning'] : [],
      pipeline_version: 'writer-audit-v1',
      mode: 'direct',
      audit_status: audited.issues?.length
        ? 'complete_with_warnings'
        : 'complete',
      audit_change_count: 0,
      source_provenance: {
        schema_version: 1,
        source_revision: audited.source.revision,
        blocks: sourceMetadata({
          ...audited.draft,
          sections: audited.draft.sections.filter(
            (section) => section.items.length > 0,
          ),
        }),
      },
    },
  };
  analysis.recent_win = groundRecentWin(
    analysis.recent_win,
    transcriptForSource(audited.source),
    {},
  );
  return applyTerminologyToProse(analysis, audited.terminologyArtifact);
};
