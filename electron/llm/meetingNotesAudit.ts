import { groundAnalysisDocument } from './analysisGrounding';
import type { AnalysisDocumentV3 } from './analysisTypes';
import { resolveSourceSpan } from './meetingNotesSource';
import {
  type AuditVerdict,
  MeetingNotesError,
  type NotesAudit,
  type NotesDraft,
  type NotesItem,
  type NotesSection,
  type NotesSource,
  type SourceSpan,
  type SupportedText,
} from './meetingNotesTypes';

export type AuditedNotes = {
  source: NotesSource;
  draft: NotesDraft;
  verdicts: ReadonlyMap<string, AuditVerdict>;
  acceptedTerminology: NotesAudit['terminology'];
};

type Block = SupportedText | NotesItem;

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
  if (value.owner !== null && typeof value.owner !== 'string') return null;
  if (value.due !== null && typeof value.due !== 'string') return null;
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
  const items = value.items.map((item, itemIndex) =>
    parseItem(item, `${id}:item:${itemIndex}`),
  );
  if (!title || items.some((item) => item === null)) return null;
  return { id, title, items: items as NotesItem[] };
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
  if (
    (parsed.overview !== null && !overview) ||
    sections.some((section) => section === null) ||
    sections.length > 64
  ) {
    throw new MeetingNotesError('notes_writer_invalid');
  }
  return {
    meetingType: meetingType as NotesDraft['meetingType'],
    overview,
    sections: sections as NotesSection[],
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
  for (const section of draft.sections) {
    if (section.title.id === target && !('kind' in value)) {
      section.title = value;
      return true;
    }
    const index = section.items.findIndex((item) => item.id === target);
    if (
      index >= 0 &&
      'kind' in value &&
      section.items[index]?.kind === value.kind
    ) {
      section.items[index] = value;
      return true;
    }
  }
  return false;
};

const sourceText = (source: NotesSource, spans: SourceSpan[]): string =>
  spans.map((span) => resolveSourceSpan(source, span)).join(' ');

const transcriptForSource = (source: NotesSource): string =>
  source.segments
    .filter((segment) => segment.text.trim())
    .map((segment) => `${segment.speaker ?? 'Speaker'}: ${segment.text}`)
    .join('\n');

const sourceMetadata = (draft: NotesDraft) =>
  Object.fromEntries(
    blocksForDraft(draft).map((block) => [
      block.id,
      { id: block.id, sources: block.sources },
    ]),
  );

export const applyNotesAudit = ({
  source,
  draft,
  audit,
}: {
  source: NotesSource;
  draft: NotesDraft;
  audit: NotesAudit;
}): AuditedNotes => {
  const next = structuredClone(draft);
  const initialIds = new Set(blocksForDraft(next).map((block) => block.id));
  if (initialIds.size !== blocksForDraft(next).length) {
    throw new MeetingNotesError('invalid_notes_audit');
  }
  for (const block of blocksForDraft(next))
    validateSources(source, block.sources);

  const verdicts = new Map<string, AuditVerdict>();
  for (const verdict of audit.verdicts) {
    if (
      !isSafeId(verdict.target) ||
      verdicts.has(verdict.target) ||
      !['supported', 'uncertain', 'unsupported'].includes(verdict.status)
    ) {
      throw new MeetingNotesError('invalid_notes_audit');
    }
    validateSources(source, verdict.sources);
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
      const value = parseItem(change.value) ?? parseSupportedText(change.value);
      if (
        !isSafeId(change.target) ||
        changedTargets.has(change.target) ||
        !value ||
        !replaceBlock(next, change.target, value)
      ) {
        throw new MeetingNotesError('invalid_notes_audit');
      }
      validateSources(source, value.sources);
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
      validateSources(source, value.sources);
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
      validateSources(source, section.title.sources);
      section.items.forEach((item) => validateSources(source, item.sources));
      next.sections.push(section);
      continue;
    }
    throw new MeetingNotesError('invalid_notes_audit');
  }

  for (const block of blocksForDraft(next)) {
    const verdict = verdicts.get(block.id);
    if (!verdict) throw new MeetingNotesError('invalid_notes_audit');
    if (verdict.status === 'unsupported') {
      removeBlock(next, block.id);
    } else if (
      verdict.status === 'uncertain' &&
      'kind' in block &&
      (block.kind === 'action' || block.kind === 'decision')
    ) {
      removeBlock(next, block.id);
    }
  }

  return {
    source,
    draft: next,
    verdicts,
    acceptedTerminology: structuredClone(audit.terminology),
  };
};

export const projectAuditedNotes = (
  audited: AuditedNotes,
): AnalysisDocumentV3 => {
  const topics = audited.draft.sections
    .filter((section) => section.items.length > 0 || section.title.text)
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
    audited.draft.overview?.text ??
    (topics
      .flatMap((topic) => [
        topic.summary,
        ...topic.key_points.map((point) => point.text),
      ])
      .filter(Boolean)
      .slice(0, 3)
      .join(' ') ||
      'Conversation captured.');
  const analysis: AnalysisDocumentV3 = {
    analysis_schema_version: 3,
    overview,
    topics,
    all_action_items: topics.flatMap((topic) =>
      topic.action_items.map((item) => ({ ...item, topic: topic.title })),
    ),
    all_decisions: topics.flatMap((topic) => topic.decisions),
    meeting_type: audited.draft.meetingType,
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
    generation_metadata: {
      provider: 'ollama',
      model: 'source-grounded',
      generation_path: 'single_pass',
      prompt_version: 'notes-v10',
      generated_at: new Date().toISOString(),
      error_categories: [],
      pipeline_version: 'writer-audit-v1',
      mode: 'direct',
      audit_status: 'complete',
      audit_change_count: 0,
      source_provenance: {
        schema_version: 1,
        source_revision: audited.source.revision,
        blocks: sourceMetadata(audited.draft),
      },
    },
  };
  const grounded = groundAnalysisDocument(
    analysis,
    transcriptForSource(audited.source),
  ).analysis;
  for (const section of audited.draft.sections) {
    const topic = grounded.topics.find(
      (entry) => entry.title === section.title.text,
    );
    if (!topic) continue;
    for (const item of section.items.filter(
      (entry) => entry.kind === 'action',
    )) {
      const verdict = audited.verdicts.get(item.id);
      const ownerIsExplicit =
        !item.owner ||
        item.sources.some((span) => {
          const segment = audited.source.segments.find(
            (entry) => entry.index === span.segment,
          );
          return (
            segment?.speaker === item.owner &&
            /\b(?:i will|i['’]ll|yes[,!]?\s+i will|will do)\b/i.test(
              segment.text,
            )
          );
        });
      if (
        verdict?.status !== 'supported' ||
        !ownerIsExplicit ||
        topic.action_items.some((entry) => entry.text === item.text)
      ) {
        continue;
      }
      topic.action_items.push({
        text: item.text,
        ...(item.owner ? { assignee: item.owner } : {}),
        ...(item.due ? { due: item.due } : {}),
        evidence: sourceText(audited.source, item.sources),
      });
    }
  }
  grounded.all_action_items = grounded.topics.flatMap((topic) =>
    topic.action_items.map((item) => ({ ...item, topic: topic.title })),
  );
  return grounded;
};
