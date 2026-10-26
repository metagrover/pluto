import { canonicalizeActionText } from '../../src/utils/actionCommitment';
import {
  groundRecentWin,
  groundSourceReviewedItem,
  hasMatchingScopedPolarity,
  hasSourceReviewedAcceptance,
  hasUnsupportedQuantityScope,
  isUnacceptedConditionalWillingness,
  normalizeTranscriptEvidence,
  sourceReviewedOngoingOwner,
} from './analysisGrounding';
import type {
  AnalysisDocumentV3,
  MeetingTerminologyArtifactV1,
  NotesProseReviewItem,
} from './analysisTypes';
import { createEditorTerminologyArtifact } from './meetingNotesEditorTerminology';
import { NOTES_EXPERIMENTS_ENABLED } from './meetingNotesExperiments';
import {
  findNotesGuardrailIssues,
  hasOmittedSubjectCondition,
  hasUnsupportedNotesCondition,
} from './meetingNotesGuardrails';
import {
  classifySuspectNotesProse,
  hasDirectFirstPersonNotesText,
  hasUnfinishedNotesText,
} from './meetingNotesProseQuality';
import {
  buildCitedSpeakerAliasProof,
  completeCitedSourceWindow,
  groupCitedSourcePassages,
  quoteCitedSourcePassages,
  resolveSourceSpan,
  sourceBoundReviewWindow,
} from './meetingNotesSource';
import {
  type AuditVerdict,
  MeetingNotesError,
  NOTES_PROMPT_VERSION,
  type NotesAudit,
  type NotesDraft,
  type NotesItem,
  type NotesReviewFailure,
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
  proseReviewItems?: NotesProseReviewItem[];
  semanticChangeCount?: number;
  reviewOriginals?: ReadonlyMap<string, NotesItem>;
};

type Block = SupportedText | NotesItem;
const reviewedResults = new WeakSet<object>();
const sourceLedResults = new WeakSet<object>();

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
  if (!win || !impact) return null;
  const ownership = ['personal', 'shared', 'other', 'unknown'].includes(
    String(value.ownership),
  )
    ? (value.ownership as NonNullable<NotesDraft['recentWin']>['ownership'])
    : undefined;
  const owner =
    typeof value.owner === 'string' && value.owner.trim()
      ? value.owner.trim()
      : null;
  return {
    win,
    impact,
    ...(ownership ? { ownership } : {}),
    ...(owner ? { owner } : {}),
  };
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
  const sections = parsed.sections.map(parseWriterSection);
  const overview =
    parsed.overview === null
      ? null
      : parseSupportedText(parsed.overview, 'overview');
  let title: SupportedText | null = null;
  if (parsed.title !== undefined && parsed.title !== null) {
    if (typeof parsed.title === 'string' && parsed.title.trim()) {
      const fallbackSources =
        overview?.sources ??
        sections.find((s) => s?.title?.sources?.length)?.title.sources ??
        [];
      title = {
        id: 'title',
        text: parsed.title.trim(),
        sources: fallbackSources,
      };
    } else {
      title = parseSupportedText(parsed.title, 'title');
    }
  }
  const noRecentWin =
    parsed.recentWin === undefined ||
    parsed.recentWin === null ||
    (isRecord(parsed.recentWin) &&
      parsed.recentWin.win === null &&
      parsed.recentWin.impact === null);
  const recentWin = noRecentWin ? undefined : parseRecentWin(parsed.recentWin);
  if (
    (parsed.title !== undefined && parsed.title !== null && !title) ||
    (parsed.overview !== null && !overview) ||
    (!noRecentWin && !recentWin) ||
    sections.some((section) => section === null) ||
    sections.length > 64
  ) {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  return {
    meetingType: meetingType as NotesDraft['meetingType'],
    ...(title ? { title } : {}),
    overview,
    sections: sections as NotesSection[],
    ...(recentWin ? { recentWin } : {}),
  };
};

export const parseCompactNotesDraft = (
  raw: string,
  maxSourceSpans = 3,
  provider?: string,
): NotesDraft => {
  const sourceSpanLimit =
    provider === 'chatgpt'
      ? Math.min(maxSourceSpans, 36)
      : NOTES_EXPERIMENTS_ENABLED
        ? maxSourceSpans
        : 3;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
  const compactKeys =
    isRecord(parsed) &&
    Object.keys(parsed).every((key) =>
      ['title', 'overview', 'meetingType', 'sections'].includes(key),
    );
  if (
    !isRecord(parsed) ||
    !compactKeys ||
    !Object.hasOwn(parsed, 'title') ||
    !Object.hasOwn(parsed, 'sections') ||
    !Array.isArray(parsed.sections) ||
    parsed.sections.length > 64
  ) {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  const sections = parsed.sections.map((section) => {
    if (
      !isRecord(section) ||
      !exactKeys(section, ['title', 'items']) ||
      typeof section.title !== 'string' ||
      !section.title.trim() ||
      section.title.length > 12_000 ||
      !Array.isArray(section.items) ||
      section.items.length === 0
    ) {
      throw new MeetingNotesError('notes_writer_invalid');
    }
    const items = section.items.map((item) => {
      const optionalMetadata =
        NOTES_EXPERIMENTS_ENABLED &&
        maxSourceSpans > 3 &&
        isRecord(item) &&
        ['kind', 'text', 'sources'].every((key) => Object.hasOwn(item, key)) &&
        Object.keys(item).every((key) =>
          ['kind', 'text', 'sources', 'owner', 'due'].includes(key),
        );
      if (
        !isRecord(item) ||
        (!exactKeys(item, ['kind', 'text', 'owner', 'due', 'sources']) &&
          !optionalMetadata) ||
        !['point', 'action', 'decision', 'question'].includes(
          String(item.kind),
        ) ||
        typeof item.text !== 'string' ||
        !item.text.trim() ||
        item.text.length > 12_000 ||
        (item.owner !== null &&
          typeof item.owner !== 'string' &&
          !(optionalMetadata && item.owner === undefined)) ||
        (item.due !== null &&
          typeof item.due !== 'string' &&
          !(optionalMetadata && item.due === undefined)) ||
        !Array.isArray(item.sources) ||
        item.sources.length === 0 ||
        item.sources.length > sourceSpanLimit ||
        item.sources.some((source) => parseSpan(source) === null)
      ) {
        throw new MeetingNotesError('notes_writer_invalid');
      }
      return {
        kind: item.kind,
        text: item.text,
        sources: item.sources,
        owner: item.owner ?? null,
        due: item.due ?? null,
      };
    });
    const titleSources = [
      ...new Map(
        items
          .flatMap((item) => item.sources as SourceSpan[])
          .map((span) => [`${span.segment}:${span.start}:${span.end}`, span]),
      ).values(),
    ];
    return {
      title: { text: section.title.trim(), sources: titleSources },
      items,
    };
  });
  const title =
    parsed.title === null
      ? null
      : isRecord(parsed.title) &&
          exactKeys(parsed.title, ['text', 'sources']) &&
          typeof parsed.title.text === 'string' &&
          Boolean(parsed.title.text.trim()) &&
          parsed.title.text.length <= 120 &&
          Array.isArray(parsed.title.sources) &&
          parsed.title.sources.length > 0 &&
          parsed.title.sources.length <=
            (NOTES_EXPERIMENTS_ENABLED && sourceSpanLimit > 3
              ? 96
              : sourceSpanLimit) &&
          parsed.title.sources.every((source) => parseSpan(source) !== null)
        ? {
            id: 'title',
            text: parsed.title.text.trim(),
            sources: parsed.title.sources,
          }
        : null;
  if (parsed.title !== null && !title) {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  const overview =
    parsed.overview === undefined || parsed.overview === null
      ? null
      : isRecord(parsed.overview) &&
          exactKeys(parsed.overview, ['text', 'sources']) &&
          Array.isArray(parsed.overview.sources) &&
          parsed.overview.sources.length <= sourceSpanLimit
        ? parseSupportedText(parsed.overview, 'overview')
        : null;
  if (parsed.overview !== undefined && parsed.overview !== null && !overview) {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  return parseNotesDraft(
    JSON.stringify({
      meetingType: 'general',
      title,
      overview,
      sections,
    }),
  );
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
  ...(draft.title ? [draft.title] : []),
  ...(draft.overview ? [draft.overview] : []),
  ...draft.sections.flatMap((section) => [section.title, ...section.items]),
  ...(draft.recentWin ? [draft.recentWin.win, draft.recentWin.impact] : []),
];

const validateSources = (source: NotesSource, spans: SourceSpan[]) => {
  if (!spans.length) throw new MeetingNotesError('invalid_notes_audit');
  for (const span of spans) resolveSourceSpan(source, span);
};

const removeBlock = (draft: NotesDraft, target: string): boolean => {
  if (draft.title?.id === target) {
    draft.title = null;
    return true;
  }
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
  if (draft.title?.id === target && !('kind' in value)) {
    draft.title = value;
    return true;
  }
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

const blockGroundingFailures = (
  text: string,
  evidence: string,
): NotesReviewFailure['reason'][] => {
  const failures: NotesReviewFailure['reason'][] = [];
  const pronouns = (value: string): string[] =>
    value
      .toLowerCase()
      .match(/\b(?:he|she|his|her|hers|him|himself|herself)\b/g) ?? [];
  if (hasUnsupportedQuantityScope(text, evidence))
    failures.push('quantity_scope');
  if (hasUnsupportedNotesCondition(text, evidence))
    failures.push('unsupported_condition');
  if (pronouns(text).some((word) => !pronouns(evidence).includes(word)))
    failures.push('unsupported_pronoun');
  return failures;
};

const extractSuspectProse = (
  source: NotesSource,
  draft: NotesDraft,
  issues: string[],
): NotesProseReviewItem[] => {
  const reviewItems: NotesProseReviewItem[] = [];
  for (const section of draft.sections) {
    section.items = section.items.flatMap((item) => {
      if (item.kind !== 'point') return [item];
      const evidence = sourceText(source, item.sources);
      const classification = classifySuspectNotesProse({
        text: item.text,
        evidence,
      });
      if (!classification) return [item];
      issues.push(`deterministic_review_unclear_prose:${item.id}`);
      reviewItems.push({
        id: item.id,
        section_title: section.title.text,
        original_text: item.text,
        evidence,
        reason: classification.reason,
        signals: classification.signals,
        sources: structuredClone(item.sources),
      });
      return [];
    });
  }
  return reviewItems;
};

const transcriptForSource = (source: NotesSource): string =>
  source.segments
    .filter((segment) => segment.text.trim())
    .map((segment) => `${segment.speaker ?? 'Speaker'}: ${segment.text}`)
    .join('\n');

// Lead with reviewed outcomes when available. Discussion stays in the body;
// this presentation choice does not validate or rewrite its meaning.
const isOutcome = (item: NotesItem) =>
  item.kind === 'decision' || item.kind === 'action';

const hasOutcomes = (draft: NotesDraft) =>
  draft.sections.some((section) => section.items.some(isOutcome));

const topicSummary = (section: NotesSection, outcomes: boolean) =>
  outcomes ? undefined : section.items.find((item) => item.kind === 'point');

const overviewForDraft = (draft: NotesDraft): SupportedText | null => {
  if (draft.overview) return draft.overview;
  const discussion = (item: NotesItem) => item.kind !== 'action';
  const firstItems = draft.sections.flatMap((section) => {
    const first = section.items.find(discussion);
    return first ? [first] : [];
  });
  const selectedIds = new Set(firstItems.map((item) => item.id));
  const remainingItems = draft.sections.flatMap((section) =>
    section.items.filter(
      (item) => !selectedIds.has(item.id) && discussion(item),
    ),
  );
  const items = [...firstItems, ...remainingItems].slice(0, 3);
  if (!items.length) {
    const actions = draft.sections.flatMap((section) =>
      section.items.filter((item) => item.kind === 'action'),
    );
    return actions.length
      ? {
          id: 'derived-overview',
          text: `The meeting recorded ${actions.length} follow-up${actions.length === 1 ? '' : 's'}.`,
          sources: actions.flatMap((item) => item.sources),
        }
      : null;
  }
  return {
    id: 'derived-overview',
    text: items
      .map((item) => {
        const text = item.text;
        return /[.!?…]["'”’)\]]*$/u.test(text) ? text : `${text}.`;
      })
      .join(' '),
    sources: items.flatMap((item) => item.sources),
  };
};

const sourceMetadata = (draft: NotesDraft, allowDerivedOverview = true) => {
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

  const overview = allowDerivedOverview
    ? overviewForDraft(draft)
    : draft.overview;
  if (draft.title) add('title', draft.title);
  if (overview) add('overview', overview);
  if (draft.recentWin) {
    add('recent_win:win', draft.recentWin.win);
    add('recent_win:why_it_counts', draft.recentWin.impact);
  }

  const outcomes = hasOutcomes(draft);
  let actionIndex = 0;
  let decisionIndex = 0;
  draft.sections.forEach((section, sectionIndex) => {
    add(`topic:${sectionIndex}:title`, section.title);
    const summary = topicSummary(section, outcomes);
    if (summary) addEditable(`topic:${sectionIndex}:summary`, summary);
    let pointIndex = 0;
    let questionIndex = 0;
    let topicActionIndex = 0;
    let topicDecisionIndex = 0;
    for (const item of section.items) {
      if (item.kind === 'point') {
        if (item !== summary) {
          addEditable(`topic:${sectionIndex}:point:${pointIndex}`, item);
          pointIndex += 1;
        }
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
    ...(analysis.title
      ? { title: replaceTerminologyAliases(analysis.title, aliases) }
      : {}),
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

/** Shared mutation validation for full audits and correction-only editors. */
export const applyNotesChanges = (
  next: NotesDraft,
  changes: NotesAudit['changes'],
  checkSources: (spans: SourceSpan[]) => void,
): void => {
  const changedTargets = new Set<string>();
  for (const change of changes) {
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

  applyNotesChanges(next, audit.changes, checkSources);

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

  // Audit changes and verdict citations establish this generation's candidates.
  // Preserve them before grounding or prose review can alter/remove the items.
  const reviewOriginals = new Map(
    next.sections.flatMap((section) =>
      section.items.map((item) => [item.id, structuredClone(item)] as const),
    ),
  );

  for (const section of next.sections) {
    section.items = section.items.flatMap((item) => {
      if (item.kind !== 'action' && item.kind !== 'decision') return [item];
      const evidence = sourceText(source, item.sources);
      const sourceLines = groupCitedSourcePassages(source, item.sources).map(
        ({ speaker, text }) => `${speaker ?? 'Speaker'}: ${text}`,
      );
      const checked = groundSourceReviewedItem(
        { ...item, kind: item.kind },
        {
          evidence,
          quotedEvidence: evidence,
          sourceLines,
          sourceLine: sourceLines.join(' '),
          lineIndex: item.sources[0]!.segment,
          speakerAliases: buildCitedSpeakerAliasProof(source, item.sources),
        },
      );
      // A supported verdict and a failed source check require repair, not a
      // clean publication with the disputed material silently deleted.
      if (!checked) {
        if (qualityPolicy === 'advisory') {
          issues.push(`notes_audit_invalid_commitment:${item.id}`);
          if (item.kind === 'action') {
            issues.push(
              ...findNotesGuardrailIssues(
                source,
                { ...next, sections: [{ ...section, items: [item] }] },
                undefined,
                ['missing_condition', 'conflicting_action'],
              ).map((issue) => `notes_guardrail:${issue.code}:${item.id}`),
            );
          }
          return [];
        }
        const polarityFeedback =
          item.kind === 'decision' &&
          !hasMatchingScopedPolarity(item.text, evidence)
            ? ':source_check_polarity_scope__separate_history_and_current_choice'
            : '';
        throw new MeetingNotesError(
          `notes_audit_invalid_commitment:${item.id}:correct_wording_or_kind_from_source${polarityFeedback}`,
        );
      }
      return [{ ...item, ...checked }];
    });
  }

  holdCollapsedPointsForReview(next, issues, reviewOriginals);
  const proseReviewItems = extractSuspectProse(source, next, issues);

  const result: AuditedNotes = {
    source,
    reviewOriginals,
    draft: next,
    verdicts,
    acceptedTerminology: structuredClone(audit.terminology),
    issues,
    ...(proseReviewItems.length ? { proseReviewItems } : {}),
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
const explicitDecisionOwner = (
  source: NotesSource,
  item: NotesItem,
): string | null => {
  const speakers = new Set(
    item.sources.flatMap((span) => {
      const segment = source.segments.find(
        (candidate) => candidate.index === span.segment,
      );
      if (!segment?.speaker) return [];
      const text = resolveSourceSpan(source, span);
      if (
        /\b(?:the decision|it)\s+is\s+(?:still\s+)?(?:pending|tentative|not\s+(?:yet\s+)?(?:final(?:ized|ised)?|settled|made|approved))\b/i.test(
          text,
        )
      )
        return [];
      return /(?:^|[.!?]\s*)i (?:decided|agreed|approved|selected|chose)\b/i.test(
        text,
      )
        ? [segment.speaker]
        : [];
    }),
  );
  return speakers.size === 1 ? [...speakers][0]! : null;
};

const holdCollapsedPointsForReview = (
  draft: NotesDraft,
  issues: string[],
  originals: ReadonlyMap<string, NotesItem>,
): void => {
  for (const section of draft.sections) {
    const seen = new Map<string, NotesItem>();
    section.items = section.items.filter((item) => {
      if (item.kind !== 'point') return true;
      const original = originals.get(item.id) ?? item;
      // Equal fallback speech does not establish equal responsibility identity.
      const key = JSON.stringify([
        item.text,
        item.owner,
        item.due,
        item.sources,
        original.kind,
        original.text,
        original.owner,
        original.due,
      ]);
      const first = seen.get(key);
      if (!first) {
        seen.set(key, item);
        return true;
      }
      issues.push(`deterministic_collapsed_points:${first.id}`);
      return false;
    });
  }
};

export const acceptEditedNotes = ({
  source,
  draft,
  terminology,
  proposals = [],
  acceptancePolicy = 'strict',
  compactNormalization = false,
  reviewOriginals: inheritedOriginals,
}: {
  source: NotesSource;
  draft: NotesDraft;
  reviewOriginals?: ReadonlyMap<string, NotesItem>;
  terminology?: AuditTerminologyContext;
  proposals?: NotesAudit['terminology'];
  acceptancePolicy?: 'strict' | 'conservative';
  compactNormalization?: boolean;
}): AuditedNotes => {
  const next = structuredClone(draft);
  const reviewOriginals = new Map(
    draft.sections.flatMap((section) =>
      section.items.map((item) => [item.id, structuredClone(item)] as const),
    ),
  );
  for (const [id, item] of inheritedOriginals ?? []) {
    if (!reviewOriginals.has(id)) continue;
    if (item.id !== id) throw new MeetingNotesError('invalid_notes_audit');
    validateSources(source, item.sources);
    reviewOriginals.set(id, structuredClone(item));
  }
  const issues: string[] = [];
  const groundingFailures: NotesReviewFailure[] = [];
  for (const block of blocksForDraft(next)) {
    validateSources(source, block.sources);
    const evidence = groupCitedSourcePassages(source, block.sources)
      .map(({ text }) => text)
      .join(' ');
    if (hasUncitedSourceLabel(block, evidence)) {
      throw new MeetingNotesError(`notes_editor_source_label:${block.id}`);
    }
    if (acceptancePolicy === 'strict') {
      for (const reason of blockGroundingFailures(block.text, evidence))
        groundingFailures.push(Object.freeze({ reason, target: block.id }));
    }
  }
  let validationError: MeetingNotesError | undefined;
  if (groundingFailures.length) {
    const first = groundingFailures[0]!;
    const commitment = next.sections.some((section) =>
      section.items.some(
        (item) =>
          item.id === first.target &&
          (item.kind === 'action' || item.kind === 'decision'),
      ),
    );
    validationError = new MeetingNotesError(
      commitment
        ? `notes_editor_invalid_commitment:${first.target}:correct_wording_kind_owner_or_due_from_source`
        : `notes_editor_${first.reason}:${first.target}`,
    );
  }
  // The single repair needs every known failure, including ones hidden by prose errors.
  const rejectCommitment = (item: NotesItem, code: string) => {
    validationError ??= new MeetingNotesError(code);
    groundingFailures.push({ reason: 'source_grounding', target: item.id });
    return [item];
  };
  for (const section of next.sections) {
    section.items = section.items.flatMap((item) => {
      if (item.kind !== 'action' && item.kind !== 'decision') return [item];
      const evidence = sourceText(source, item.sources);
      const sourceLines = groupCitedSourcePassages(source, item.sources).map(
        ({ speaker, text }) => `${speaker ?? 'Speaker'}: ${text}`,
      );
      const discussionText = quoteCitedSourcePassages(source, item.sources);
      const declaredDecisionOwner =
        compactNormalization && item.kind === 'decision'
          ? explicitDecisionOwner(source, item)
          : null;
      const reviewedItem = declaredDecisionOwner
        ? { ...item, owner: item.owner ?? declaredDecisionOwner }
        : item;
      if (
        item.kind === 'action' &&
        isUnacceptedConditionalWillingness(evidence)
      ) {
        if (acceptancePolicy === 'conservative') {
          issues.push(
            `deterministic_reclassified_conditional_willingness:${item.id}`,
          );
          return [
            {
              ...item,
              kind: 'point' as const,
              text: discussionText,
              owner: null,
              due: null,
            },
          ];
        }
        return rejectCommitment(
          item,
          `notes_editor_invalid_commitment:${item.id}:conditional_willingness_is_not_accepted__change_kind_to_point_and_preserve_can_or_could_not_will_in_text`,
        );
      }
      const resolved = {
        evidence,
        quotedEvidence: evidence,
        sourceLines,
        sourceLine: sourceLines.join(' '),
        lineIndex: item.sources[0]!.segment,
        speakerAliases: buildCitedSpeakerAliasProof(source, item.sources),
      };
      const checked = groundSourceReviewedItem(
        { ...reviewedItem, kind: item.kind },
        resolved,
      );
      if (!checked) {
        const statusExplanation =
          /\b(?:withdraw|retract|cancel|replac|supersed)\w*\b/i;
        if (
          item.kind === 'decision' &&
          compactNormalization &&
          // Collective decisions remain decisions without an individual owner.
          !/\b(?:the decision is|(?:we|i) (?:decided|agreed|approved|selected|chose)|proceed with)\b/i.test(
            evidence,
          ) &&
          statusExplanation.test(item.text) &&
          statusExplanation.test(evidence)
        ) {
          issues.push(`deterministic_reclassified_decision:${item.id}`);
          return [{ ...item, kind: 'point' as const, owner: null, due: null }];
        }
        if (acceptancePolicy === 'conservative') {
          issues.push(`deterministic_unsupported_commitment:${item.id}`);
          issues.push(`deterministic_preserved_discussion:${item.id}`);
          // A rejected commitment classification must not erase the source.
          // Copy its exact evidence, never the rejected model assertion.
          return [
            {
              ...item,
              kind: 'point' as const,
              text: discussionText,
              owner: null,
              due: null,
            },
          ];
        }
        return rejectCommitment(
          item,
          `notes_editor_invalid_commitment:${item.id}:correct_wording_kind_owner_or_due_from_source`,
        );
      }
      if (
        acceptancePolicy === 'conservative' &&
        item.kind === 'action' &&
        !checked.owner
      ) {
        issues.push(`deterministic_preserved_unowned_discussion:${item.id}`);
        return [
          {
            ...item,
            kind: 'point' as const,
            text: discussionText,
            owner: null,
            due: null,
          },
        ];
      }
      const ownerChanged =
        Boolean(item.owner) &&
        normalizeTranscriptEvidence(item.owner ?? '') !==
          normalizeTranscriptEvidence(checked.owner ?? '');
      const dueRemoved = Boolean(item.due) && !checked.due;
      // A decision author is optional; unproved metadata must not discard its grounded text.
      if (
        acceptancePolicy === 'strict' &&
        ((item.kind === 'action' && ownerChanged) || dueRemoved)
      ) {
        return rejectCommitment(
          item,
          `notes_editor_invalid_commitment:${item.id}:correct_wording_kind_owner_or_due_from_source`,
        );
      }
      if (ownerChanged) issues.push(`deterministic_corrected_owner:${item.id}`);
      if (dueRemoved) issues.push(`deterministic_removed_due:${item.id}`);
      if (
        item.kind === 'action' &&
        ownerChanged &&
        canonicalizeActionText(item.text, item.owner!) !== checked.text
      ) {
        issues.push(`deterministic_reclassified_owner_conflict:${item.id}`);
        return [
          {
            ...item,
            kind: 'point' as const,
            text: discussionText,
            owner: null,
            due: null,
          },
        ];
      }
      return [{ ...item, ...checked }];
    });
  }
  if (validationError) {
    sourceLedValidationFailures.set(
      validationError,
      Object.freeze(groundingFailures),
    );
    throw validationError;
  }
  holdCollapsedPointsForReview(next, issues, reviewOriginals);
  const proseReviewItems = extractSuspectProse(source, next, issues);
  const result: AuditedNotes = {
    source,
    reviewOriginals,
    draft: next,
    verdicts: new Map(),
    acceptedTerminology: structuredClone(proposals),
    ...(issues.length ? { issues } : {}),
    ...(proseReviewItems.length ? { proseReviewItems } : {}),
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

/** Shared existing single-responsibility coverage check; no new classification rules. */
export const hasOngoingSourceResponsibility = (
  notes: Pick<AuditedNotes, 'source' | 'draft'>,
  item: NotesItem,
  requireUnrepresented = false,
): boolean => {
  const aliases = buildCitedSpeakerAliasProof(notes.source, item.sources);
  const taskSources = item.sources.filter(
    (span) =>
      !aliases.some((alias) =>
        alias.introductionSources.some(
          (intro) =>
            intro.segment === span.segment &&
            intro.start === span.start &&
            intro.end === span.end,
        ),
      ),
  );
  const passages = groupCitedSourcePassages(notes.source, taskSources);
  // This coverage gate handles an unambiguous current responsibility only.
  // Other clauses may cancel or finish it; their final state belongs to review.
  const clauses = passages
    .flatMap(({ text }) => text.match(/[^.?!;]+[.?!;]?/g) ?? [])
    .filter(
      (clause) =>
        normalizeTranscriptEvidence(clause) !== 'that work is ongoing',
    );
  if (requireUnrepresented && clauses.length !== 1) return false;
  return passages.some(({ speaker, text }) =>
    (text.match(/[^.?!;]+[.?!;]?/g) ?? []).some((clause) => {
      const predicate = clause.replace(
        /^\s*i(?: am|['’]m)\s+(?:(?:currently|still)\s+)?/iu,
        '',
      );
      const owner = sourceReviewedOngoingOwner(predicate, speaker, {
        evidence: text,
        quotedEvidence: text,
        sourceLine: `${speaker ?? 'Speaker'}: ${text}`,
        sourceLines: [`${speaker ?? 'Speaker'}: ${text}`],
        lineIndex: item.sources[0]!.segment,
      });
      if (!owner) return false;
      if (!requireUnrepresented) return true;
      // A separate action can already cover this exact responsibility; scope
      // clarification beside it must not be forced into a duplicate action.
      return !notes.draft.sections.some((section) =>
        section.items.some((other) => {
          if (other.id === item.id || other.kind !== 'action') return false;
          const aliases = buildCitedSpeakerAliasProof(
            notes.source,
            other.sources,
          );
          const alias = aliases.find(
            (entry) => entry.name === other.owner && entry.speaker === owner,
          );
          if (other.owner !== owner && !alias) return false;
          // Identity evidence may accompany this exact task, never unrelated work.
          const taskSources = other.sources.filter(
            (span) =>
              !alias?.introductionSources.some(
                (intro) =>
                  intro.segment === span.segment &&
                  intro.start === span.start &&
                  intro.end === span.end,
              ),
          );
          const passages = groupCitedSourcePassages(notes.source, taskSources);
          return (
            passages.length === 1 &&
            passages[0]!.speaker === speaker &&
            normalizeTranscriptEvidence(passages[0]!.text) ===
              normalizeTranscriptEvidence(clause) &&
            taskSources.every((span) =>
              item.sources.some(
                (cited) =>
                  cited.segment === span.segment &&
                  cited.start <= span.start &&
                  cited.end >= span.end,
              ),
            )
          );
        }),
      );
    }),
  );
};

/** Final source-led boundary: no advisory normalization or raw-source recovery. */
const sourceLedValidationFailures = new WeakMap<
  MeetingNotesError,
  readonly NotesReviewFailure[]
>();
export const getSourceLedValidationFailures = (error: unknown) =>
  error instanceof MeetingNotesError
    ? sourceLedValidationFailures.get(error)
    : undefined;
const hasUncitedSourceLabel = (block: SupportedText, evidence: string) =>
  (block.text.match(/\b[RP]\d+\b/g) ?? []).some(
    (label) => !evidence.includes(label),
  );

export const acceptSourceLedNotes = (
  source: NotesSource,
  draft: NotesDraft,
  options: {
    proposals?: NotesAudit['terminology'];
    terminology?: AuditTerminologyContext;
  } = {},
): AuditedNotes => {
  const failures = new Map<string, NotesReviewFailure>();
  const report = (
    reason: NotesReviewFailure['reason'],
    target: string | null,
  ) =>
    failures.set(
      `${reason}:${target ?? ''}`,
      Object.freeze({ reason, target }),
    );
  const refuse = (): never => {
    const error = new MeetingNotesError('notes_semantic_review_incomplete');
    sourceLedValidationFailures.set(
      error,
      Object.freeze([...failures.values()]),
    );
    throw error;
  };
  if (!draft.overview?.text.trim()) report('invalid_schema', null);
  const contains = (text: string, value: string) =>
    ` ${normalizeTranscriptEvidence(text)} `.includes(
      ` ${normalizeTranscriptEvidence(value)} `,
    );
  const check = (block: SupportedText, item?: NotesItem) => {
    validateSources(source, block.sources);
    const passages = groupCitedSourcePassages(source, block.sources);
    const evidence = passages.map(({ text }) => text).join(' ');
    if (
      hasUnfinishedNotesText(block.text) ||
      hasDirectFirstPersonNotesText(block.text)
    )
      report('unfinished_prose', block.id);
    if (block.text === quoteCitedSourcePassages(source, block.sources))
      report('raw_source_quote', block.id);
    for (const reason of blockGroundingFailures(block.text, evidence))
      report(reason, block.id);
    if (hasUncitedSourceLabel(block, evidence))
      report('source_label', block.id);
    if (!item) return;
    if (
      (item.kind === 'point' || item.kind === 'question') &&
      (item.owner !== null || item.due !== null)
    )
      report('overview_role', item.id);
    if (
      item.owner !== null &&
      (['them', 'unknown', 'speaker'].includes(item.owner.toLowerCase()) ||
        !passages.some(
          ({ speaker, text }) =>
            speaker === item.owner ||
            (item.owner!.toLowerCase() !== 'me' && contains(text, item.owner!)),
        ))
    )
      report('unsupported_owner', item.id);
    if (
      item.due !== null &&
      !passages.some(({ text }) =>
        sourceBoundDueForms(item.due!).some((form) =>
          contains(
            text.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1'),
            form.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1'),
          ),
        ),
      )
    )
      report('unsupported_due', item.id);
  };
  for (const block of blocksForDraft(draft)) check(block);
  for (const section of draft.sections)
    for (const item of section.items) {
      check(item, item);
      if (
        item.kind !== 'action' &&
        hasOngoingSourceResponsibility({ source, draft }, item, true)
      )
        report('ongoing_responsibility', item.id);
    }
  if (draft.recentWin) {
    const win = draft.recentWin;
    if (
      !win.ownership ||
      (['shared', 'unknown'].includes(win.ownership) && win.owner != null) ||
      (win.ownership === 'personal' && !win.owner)
    )
      report('win_ownership', win.win.id);
    if (
      win.owner &&
      !groupCitedSourcePassages(source, win.win.sources).some(
        ({ speaker, text }) =>
          speaker === win.owner || contains(text, win.owner!),
      )
    )
      report('unsupported_owner', win.win.id);
    const evidence = sourceText(source, win.win.sources);
    if (
      !groundRecentWin(
        {
          win: win.win.text,
          why_it_counts: win.impact.text,
          evidence,
          ownership: win.ownership,
          owner: win.owner ?? undefined,
        },
        transcriptForSource(source),
        {},
      )
    )
      report('source_grounding', win.win.id);
  }
  if (
    findNotesGuardrailIssues(source, draft, undefined, [
      'missing_condition',
      'conflicting_action',
    ]).length
  )
    report('source_guardrail', null);
  if (failures.size) refuse();
  let accepted: AuditedNotes;
  try {
    accepted = acceptEditedNotes({
      source,
      draft,
      acceptancePolicy: 'strict',
      proposals: options.proposals,
      terminology: options.terminology,
    });
  } catch (error) {
    if (!(error instanceof MeetingNotesError)) throw error;
    const target =
      blocksForDraft(draft).find(
        (block) =>
          error.code === `notes_editor_source_label:${block.id}` ||
          error.code.startsWith(`notes_editor_invalid_commitment:${block.id}:`),
      )?.id ?? null;
    report(
      error.code.startsWith('notes_editor_source_label:')
        ? 'source_label'
        : 'source_grounding',
      target,
    );
    sourceLedValidationFailures.set(
      error,
      Object.freeze([
        ...(sourceLedValidationFailures.get(error) ?? []),
        ...failures.values(),
      ]),
    );
    throw error;
  }
  if (accepted.issues?.length) {
    report('source_grounding', null);
    refuse();
  }
  // No source-led brand is granted until the final optional presentation check.
  if (draft.recentWin && !projectAuditedNotes(accepted).recent_win) {
    report('source_grounding', draft.recentWin.win.id);
    refuse();
  }
  sourceLedResults.add(accepted);
  return accepted;
};

export const sourceBoundDueForms = (value: string) => {
  if (value.length !== 10 || value[4] !== '-' || value[7] !== '-')
    return [value];
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return [value];
  return [
    value,
    ...['en-US', 'en-GB'].map((locale) =>
      new Intl.DateTimeFormat(locale, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date),
    ),
  ];
};

export const sourceBoundDueMatches = (
  due: string,
  original: string,
  sourceEvidence?: string,
): boolean => {
  const normalized = (value: string) =>
    normalizeTranscriptEvidence(
      value.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1'),
    );
  const forms = sourceBoundDueForms(due).map(normalized);
  const evidence =
    sourceEvidence === undefined ? null : ` ${normalized(sourceEvidence)} `;
  if (forms.includes(normalized(original)))
    return (
      evidence === null || forms.some((form) => evidence.includes(` ${form} `))
    );
  if (evidence === null) return false;
  // A model-invented year cannot prevent correction to the exact source deadline.
  return sourceBoundDueForms(original).some((form) => {
    const draft = normalized(form);
    const date = draft.replace(/ \d{4}$/, '');
    if (date === draft || !evidence.includes(` ${date} `)) return false;
    const sourceYear = new RegExp(` ${date} (\\d{4})(?: |$)`).exec(
      evidence,
    )?.[1];
    const expected = sourceYear ? `${date} ${sourceYear}` : date;
    return forms.includes(expected) && evidence.includes(` ${expected} `);
  });
};

export type SourceBoundNotesReplacement = NotesItem & {
  discussion?: string | null;
  mergedIds?: string[];
  ownership?: 'personal' | 'shared' | 'other' | 'unknown';
};
export type SourceBoundNotesOmission = { id: string; omit: true };

/** Admission only: semantic review cannot bypass the existing source checks. */
export const hasSourceReviewedAdmission = (
  source: NotesSource,
  item: NotesItem,
): boolean => {
  if (item.kind !== 'action' && item.kind !== 'decision') return true;
  const evidence = sourceText(source, item.sources);
  const sourceLines = groupCitedSourcePassages(source, item.sources).map(
    ({ speaker, text }) => `${speaker ?? 'Speaker'}: ${text}`,
  );
  return hasSourceReviewedAcceptance(
    { ...item, kind: item.kind },
    {
      evidence,
      quotedEvidence: evidence,
      sourceLines,
      sourceLine: sourceLines.join(' '),
      lineIndex: item.sources[0]!.segment,
    },
  );
};

/** Exact bounded dialogue/lifecycle context, never a classification. */
export const sourceBoundItemReviewWindow = (
  audited: Pick<AuditedNotes, 'source' | 'draft' | 'reviewOriginals'>,
  item: NotesItem,
): SourceSpan[] => {
  // A point may be promoted by the model. Probe the existing action guard only
  // to discover cancellation or prerequisite evidence; never change the item.
  const issues = findNotesGuardrailIssues(
    audited.source,
    {
      ...audited.draft,
      sections: [
        { ...audited.draft.sections[0]!, items: [{ ...item, kind: 'action' }] },
      ],
    },
    undefined,
    ['missing_condition', 'conflicting_action'],
  );
  const window = sourceBoundReviewWindow(audited.source, [
    ...item.sources,
    ...issues.flatMap((issue) => issue.sources),
  ]);
  // Only the immutable original question anchors forward context. Expanded
  // review citations (or newly inserted items) must not crawl later dialogue.
  const original = audited.reviewOriginals?.get(item.id);
  if (!original?.sources.length) return window;
  const questions = original.sources.filter((span) =>
    resolveSourceSpan(audited.source, span).includes('?'),
  );
  if (original.kind !== 'question' && !questions.length) return window;
  const anchor = Math.max(
    ...(questions.length ? questions : original.sources).map(
      (span) => span.segment,
    ),
  );
  const following = audited.source.segments
    .filter(
      (segment) => segment.index > anchor && segment.text.trim().length > 0,
    )
    .map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
  const turns = groupCitedSourcePassages(audited.source, following).slice(0, 3);
  return completeCitedSourceWindow(audited.source, [
    ...window,
    ...turns.flatMap((turn) => turn.spans),
  ]);
};

export const applySourceBoundSemanticReview = (
  audited: AuditedNotes,
  resolutions: Array<SourceBoundNotesReplacement | SourceBoundNotesOmission>,
): AuditedNotes => {
  if (!reviewedResults.has(audited))
    throw new MeetingNotesError('notes_unreviewed_projection');
  const next = { ...audited, draft: structuredClone(audited.draft) };
  if (new Set(resolutions.map((item) => item.id)).size !== resolutions.length)
    throw new MeetingNotesError('invalid_notes_audit');
  const omissions = resolutions.filter(
    (item): item is SourceBoundNotesOmission => 'omit' in item,
  );
  const replacements = resolutions.filter(
    (item): item is SourceBoundNotesReplacement => !('omit' in item),
  );
  const recentWin = next.draft.recentWin;
  const optionalIds = recentWin ? [recentWin.win.id, recentWin.impact.id] : [];
  if (
    omissions.some(
      (item) =>
        item.omit !== true ||
        Object.keys(item).length !== 2 ||
        !optionalIds.includes(item.id),
    )
  )
    throw new MeetingNotesError('invalid_notes_audit');
  if (
    replacements.some(
      (item) => item.ownership !== undefined && item.id !== recentWin?.win.id,
    )
  )
    throw new MeetingNotesError('invalid_notes_audit');
  const optionalResults = resolutions.filter((item) =>
    optionalIds.includes(item.id),
  );
  if (optionalResults.length && optionalResults.length !== 2)
    throw new MeetingNotesError('invalid_notes_audit');
  for (const replacement of replacements.filter((item) =>
    optionalIds.includes(item.id),
  )) {
    const original =
      replacement.id === recentWin!.win.id ? recentWin!.win : recentWin!.impact;
    if (
      replacement.kind !== 'point' ||
      replacement.due !== null ||
      replacement.discussion ||
      replacement.mergedIds?.length ||
      !replacement.text.trim() ||
      hasUnfinishedNotesText(replacement.text) ||
      hasDirectFirstPersonNotesText(replacement.text) ||
      replacement.text ===
        quoteCitedSourcePassages(audited.source, replacement.sources)
    )
      throw new MeetingNotesError('invalid_notes_audit');
    const permitted = new Set(
      original.sources.map((span) => JSON.stringify(span)),
    );
    if (
      replacement.sources.length !== original.sources.length ||
      new Set(replacement.sources.map((span) => JSON.stringify(span))).size !==
        permitted.size ||
      replacement.sources.some((span) => !permitted.has(JSON.stringify(span)))
    )
      throw new MeetingNotesError('notes_source_out_of_scope');
    if (replacement.id === recentWin!.impact.id) {
      if (replacement.owner !== null || replacement.ownership !== undefined)
        throw new MeetingNotesError('invalid_notes_audit');
    } else {
      const ownership = replacement.ownership;
      if (
        !ownership ||
        !['personal', 'shared', 'other', 'unknown'].includes(ownership) ||
        (['shared', 'unknown'].includes(ownership) &&
          replacement.owner !== null) ||
        (ownership === 'personal' && !replacement.owner)
      )
        throw new MeetingNotesError('invalid_notes_audit');
      if (replacement.owner) {
        const owner = normalizeTranscriptEvidence(replacement.owner);
        const passages = groupCitedSourcePassages(
          audited.source,
          original.sources,
        );
        if (
          ['me', 'them', 'unknown', 'speaker'].includes(owner) &&
          owner !== 'me'
        )
          throw new MeetingNotesError('invalid_notes_audit');
        if (
          !passages.some(
            ({ speaker, text }) =>
              speaker === replacement.owner ||
              ` ${normalizeTranscriptEvidence(text)} `.includes(` ${owner} `),
          )
        )
          throw new MeetingNotesError('invalid_notes_audit');
      }
    }
  }
  if (optionalResults.length) {
    if (omissions.length) next.draft.recentWin = undefined;
    else {
      const win = replacements.find((item) => item.id === recentWin!.win.id)!;
      const impact = replacements.find(
        (item) => item.id === recentWin!.impact.id,
      )!;
      next.draft.recentWin = {
        win: {
          id: win.id,
          text: win.text,
          sources: structuredClone(win.sources),
        },
        impact: {
          id: impact.id,
          text: impact.text,
          sources: structuredClone(impact.sources),
        },
        ownership: win.ownership,
        owner: win.owner,
      };
    }
  }
  const byId = new Map(
    replacements
      .filter((item) => !optionalIds.includes(item.id))
      .map((item) => [item.id, item]),
  );

  const originalItems = new Map(
    audited.draft.sections.flatMap((section) =>
      section.items.map((item) => [item.id, item] as const),
    ),
  );
  const removed = new Set<string>();
  for (const replacement of replacements) {
    if (replacement.mergedIds?.length) {
      const members = [replacement.id, ...replacement.mergedIds].map(
        (id) => audited.reviewOriginals?.get(id) ?? originalItems.get(id),
      );
      if (
        !replacement.owner ||
        members.some(
          (item) =>
            !item ||
            !item.owner ||
            normalizeTranscriptEvidence(item.owner) !==
              normalizeTranscriptEvidence(replacement.owner!) ||
            (item.due &&
              !sourceBoundDueMatches(
                replacement.due ?? '',
                item.due,
                sourceText(audited.source, item.sources),
              )),
        )
      )
        throw new MeetingNotesError('invalid_notes_audit');
    }
    if (
      replacement.mergedIds?.length &&
      (
        audited.reviewOriginals?.get(replacement.id) ??
        originalItems.get(replacement.id)
      )?.kind !== 'action'
    )
      throw new MeetingNotesError('invalid_notes_audit');
    for (const id of replacement.mergedIds ?? []) {
      const member = originalItems.get(id);
      if (
        !member ||
        id === replacement.id ||
        removed.has(id) ||
        byId.has(id) ||
        replacement.kind !== 'action' ||
        (audited.reviewOriginals?.get(id) ?? member).kind !== 'action'
      )
        throw new MeetingNotesError('invalid_notes_audit');
      removed.add(id);
    }
  }
  const existingIds = new Set(
    blocksForDraft(next.draft).map((block) => block.id),
  );
  const overview = next.draft.overview;
  const overviewReplacement = overview ? byId.get(overview.id) : undefined;
  if (overview && overviewReplacement) {
    if (
      overviewReplacement.kind !== 'point' ||
      overviewReplacement.owner !== null ||
      overviewReplacement.due !== null ||
      overviewReplacement.discussion ||
      overviewReplacement.mergedIds?.length ||
      !overviewReplacement.text.trim() ||
      hasUnfinishedNotesText(overviewReplacement.text) ||
      hasDirectFirstPersonNotesText(overviewReplacement.text) ||
      overviewReplacement.text ===
        quoteCitedSourcePassages(audited.source, overviewReplacement.sources)
    )
      throw new MeetingNotesError('invalid_notes_audit');
    const permitted = new Set(
      overview.sources.map((span) => JSON.stringify(span)),
    );
    if (
      overviewReplacement.sources.length !== overview.sources.length ||
      new Set(overviewReplacement.sources.map((span) => JSON.stringify(span)))
        .size !== permitted.size ||
      overviewReplacement.sources.some(
        (span) => !permitted.has(JSON.stringify(span)),
      )
    )
      throw new MeetingNotesError('notes_source_out_of_scope');
    next.draft.overview = {
      id: overview.id,
      text: overviewReplacement.text,
      sources: structuredClone(overviewReplacement.sources),
    };
    byId.delete(overview.id);
  }
  for (const section of next.draft.sections) {
    section.items = section.items.flatMap((item) => {
      if (removed.has(item.id)) return [];
      const replacement = byId.get(item.id);
      if (!replacement) return [item];
      const mergedSources = replacement.mergedIds?.length
        ? [
            ...new Map(
              [item.id, ...replacement.mergedIds]
                .flatMap((id) =>
                  sourceBoundItemReviewWindow(audited, originalItems.get(id)!),
                )
                .map((span) => [JSON.stringify(span), span]),
            ).values(),
          ].sort(
            (left, right) =>
              left.segment - right.segment ||
              left.start - right.start ||
              left.end - right.end,
          )
        : undefined;
      if (
        mergedSources &&
        JSON.stringify(replacement.sources) !== JSON.stringify(mergedSources)
      )
        throw new MeetingNotesError('notes_source_out_of_scope');
      if (
        !(
          mergedSources &&
          JSON.stringify(replacement.sources) === JSON.stringify(mergedSources)
        ) &&
        JSON.stringify(replacement.sources) !== JSON.stringify(item.sources) &&
        JSON.stringify(replacement.sources) !==
          JSON.stringify(sourceBoundItemReviewWindow(audited, item))
      )
        throw new MeetingNotesError('notes_source_out_of_scope');
      if (
        replacement.kind === 'action' &&
        hasOmittedSubjectCondition(
          {
            ...(audited.reviewOriginals?.get(item.id) ?? item),
            owner: replacement.owner,
          },
          replacement.text,
          groupCitedSourcePassages(audited.source, replacement.sources),
        )
      )
        throw new MeetingNotesError('invalid_notes_audit');
      if (!hasSourceReviewedAdmission(audited.source, replacement))
        throw new MeetingNotesError('invalid_notes_audit');
      const { discussion, mergedIds: _mergedIds, ...fields } = replacement;
      const contextId = `${item.id}:semantic-context`;
      if (discussion && existingIds.has(contextId))
        throw new MeetingNotesError('invalid_notes_audit');
      byId.delete(item.id);
      return [
        fields,
        ...(discussion
          ? [
              {
                id: contextId,
                kind: 'point' as const,
                text: discussion,
                owner: null,
                due: null,
                sources: replacement.sources,
              },
            ]
          : []),
      ];
    });
  }
  if (byId.size) throw new MeetingNotesError('invalid_notes_audit');
  const ids = new Set([...removed, ...resolutions.map((item) => item.id)]);
  next.issues = audited.issues?.filter(
    (issue) =>
      ![...ids].some(
        (id) => issue.startsWith('deterministic_') && issue.endsWith(`:${id}`),
      ),
  );
  next.proseReviewItems = audited.proseReviewItems?.filter(
    (item) => !ids.has(item.id),
  );
  next.semanticChangeCount =
    (audited.semanticChangeCount ?? 0) +
    removed.size +
    omissions.length +
    replacements.length +
    replacements.filter((item) => item.discussion).length;
  reviewedResults.add(next);
  return next;
};

export const projectAuditedNotes = (
  audited: AuditedNotes,
  options: { deriveOverview?: boolean } = {},
): AnalysisDocumentV3 => {
  if (!reviewedResults.has(audited))
    throw new MeetingNotesError('notes_unreviewed_projection');
  const draft = {
    ...audited.draft,
    sections: audited.draft.sections.map((section) => {
      const seen = new Map<string, number>();
      const items: NotesItem[] = [];
      for (const item of section.items) {
        if (item.kind === 'question') {
          items.push(item);
          continue;
        }
        const key = JSON.stringify([
          item.kind,
          item.text,
          item.owner,
          item.due,
          item.sources,
        ]);
        const duplicate = seen.get(key);
        if (duplicate !== undefined) {
          continue;
        }
        if (item.kind === 'action' && item.owner !== null) {
          const contained = items.findIndex(
            (prior) =>
              prior.kind === 'action' &&
              prior.owner === item.owner &&
              prior.due === item.due &&
              JSON.stringify(prior.sources) === JSON.stringify(item.sources) &&
              // Keep only lossless whole-clause containment; a shared prefix
              // alone cannot establish equal predicates or responsibility.
              (prior.text.startsWith(`${item.text.replace(/\.$/, '')}; `) ||
                item.text.startsWith(`${prior.text.replace(/\.$/, '')}; `)),
          );
          if (contained !== -1) {
            if (item.text.length > items[contained]!.text.length)
              items[contained] = item;
            seen.set(key, contained);
            continue;
          }
        }
        seen.set(key, items.length);
        items.push(item);
      }
      return {
        ...section,
        items,
      };
    }),
  };
  const outcomes = hasOutcomes(draft);
  const topics = draft.sections
    .filter((section) => section.items.length > 0)
    .map((section) => {
      const summary = topicSummary(section, outcomes);
      const points = section.items.filter(
        (item) => item.kind === 'point' && item !== summary,
      );
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
        summary: summary?.text ?? '',
        key_points: points.map((point) => ({ text: point.text })),
        decisions,
        action_items: actions,
        open_questions: section.items
          .filter((item) => item.kind === 'question')
          .map((item) => item.text),
      };
    });
  const allowDerivedOverview =
    options.deriveOverview !== false && !sourceLedResults.has(audited);
  const overview =
    (allowDerivedOverview
      ? overviewForDraft(draft)?.text
      : draft.overview?.text) ??
    (allowDerivedOverview ? 'Conversation captured.' : '');
  const title = draft.title?.text.trim() || undefined;
  const analysis: AnalysisDocumentV3 = {
    analysis_schema_version: 3,
    ...(title ? { title } : {}),
    overview,
    topics,
    all_action_items: topics.flatMap((topic) =>
      topic.action_items.map((item) => ({ ...item, topic: topic.title })),
    ),
    all_decisions: topics.flatMap((topic) => topic.decisions),
    ...(draft.recentWin
      ? {
          recent_win: {
            win: draft.recentWin.win.text,
            why_it_counts: draft.recentWin.impact.text,
            evidence: sourceText(audited.source, [
              ...draft.recentWin.win.sources,
              ...draft.recentWin.impact.sources,
            ]),
            ...(draft.recentWin.ownership
              ? { ownership: draft.recentWin.ownership }
              : {}),
            ...(draft.recentWin.owner ? { owner: draft.recentWin.owner } : {}),
          },
        }
      : {}),
    meeting_type: draft.meetingType,
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
      audit_change_count: audited.semanticChangeCount ?? 0,
      source_provenance: {
        schema_version: 1,
        source_revision: audited.source.revision,
        blocks: sourceMetadata(
          {
            ...draft,
            sections: draft.sections.filter(
              (section) => section.items.length > 0,
            ),
          },
          allowDerivedOverview,
        ),
      },
      ...(audited.proseReviewItems?.length
        ? {
            prose_review: {
              schema_version: 1,
              items: structuredClone(audited.proseReviewItems),
            },
          }
        : {}),
    },
  };
  analysis.recent_win = groundRecentWin(
    analysis.recent_win,
    transcriptForSource(audited.source),
    {},
  );
  return applyTerminologyToProse(analysis, audited.terminologyArtifact);
};
