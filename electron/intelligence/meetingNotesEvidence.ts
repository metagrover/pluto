import { createHash } from 'node:crypto';
import {
  parseAnalysisDocumentV3Json,
  parseUserEditsJson,
} from '../../src/utils/analysisDocument';
import { buildMeetingNotesDocument } from '../../src/utils/meetingNotesDocument';

export type SavedMeetingEvidencePolicy =
  | 'notes_only'
  | 'transcript_exact'
  | 'transcript_fallback';

export interface MeetingNotesEvidenceSource {
  id: string | number;
  title?: string | null;
  user_notes?: string | null;
  enhanced_notes?: string | null;
  analysis_json?: string | null;
  user_edits_json?: string | null;
  mid_json?: string | null;
  analysis_format_pass?: boolean | number | null;
}

export interface MeetingNotesEvidenceReference {
  blockId: string;
  path?: string;
  quote?: string;
  transcriptRange?: [number, number];
}

export interface MeetingNotesEvidenceSection {
  sectionId: string;
  heading: string;
  kind: string;
  summary: string;
  content: string;
  entitiesText: string;
  evidenceReferences: MeetingNotesEvidenceReference[];
  transcriptRange?: [number, number];
}

export interface MeetingNotesEvidenceDocument {
  meetingId: string;
  title: string;
  notesText: string;
  decisionsText: string;
  actionItemsText: string;
  topicsText: string;
  participantsText: string;
  sourceRevision: string;
  trustStatus: 'grounded' | 'needs_review';
  sections: MeetingNotesEvidenceSection[];
  hasUsableNotes: boolean;
}

interface MidEvidence {
  participants?: Array<{ name?: unknown }>;
  topics?: Array<{ name?: unknown }>;
  decisions?: Array<{ description?: unknown }>;
  action_items?: Array<{ description?: unknown }>;
  projects?: Array<{ name?: unknown }>;
}

const EXACT_WORDING_INTENT =
  /\b(quote|verbatim|word for word|exact(?:ly)?(?: what| how)?|exact words?)\b/i;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const uniqueText = (values: string[]): string => {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
};

const normalizedItemText = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return clean(record.text) || clean(record.description);
};

const parseMidEvidence = (value: string | null | undefined): MidEvidence => {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as MidEvidence) : {};
  } catch {
    return {};
  }
};

export const resolveSavedMeetingEvidencePolicy = (
  query: string,
  hasUsableNotes: boolean,
): SavedMeetingEvidencePolicy => {
  if (EXACT_WORDING_INTENT.test(query)) return 'transcript_exact';
  return hasUsableNotes ? 'notes_only' : 'transcript_fallback';
};

export const buildMeetingNotesEvidenceDocument = (
  meeting: MeetingNotesEvidenceSource,
  speakerDisplayNames: Readonly<Record<string, string>> = {},
): MeetingNotesEvidenceDocument => {
  const v3 = parseAnalysisDocumentV3Json(meeting.analysis_json);
  const mid = parseMidEvidence(meeting.mid_json);
  const normalizedV3 = v3
    ? {
        ...v3,
        topics: Array.isArray(v3.topics)
          ? v3.topics.map((topic) => ({
              ...topic,
              title: clean(topic.title),
              summary: clean(topic.summary),
              key_points: Array.isArray(topic.key_points)
                ? topic.key_points.flatMap((point) => {
                    const text = normalizedItemText(point);
                    return text ? [{ ...point, text }] : [];
                  })
                : [],
              decisions: Array.isArray(topic.decisions)
                ? topic.decisions.flatMap((decision) => {
                    const text = normalizedItemText(decision);
                    return text ? [{ ...decision, text }] : [];
                  })
                : [],
              action_items: Array.isArray(topic.action_items)
                ? topic.action_items.flatMap((action) => {
                    const text = normalizedItemText(action);
                    return text ? [{ ...action, text }] : [];
                  })
                : [],
              open_questions: Array.isArray(topic.open_questions)
                ? topic.open_questions.map(clean).filter(Boolean)
                : [],
            }))
          : [],
        all_decisions: Array.isArray(v3.all_decisions)
          ? v3.all_decisions
              .map((decision) => ({
                ...decision,
                text: normalizedItemText(decision),
              }))
              .filter((decision) => decision.text)
          : [],
        all_action_items: Array.isArray(v3.all_action_items)
          ? v3.all_action_items
              .map((action) => ({
                ...action,
                text: normalizedItemText(action),
              }))
              .filter((action) => action.text)
          : [],
      }
    : null;
  const notesDocument = normalizedV3
    ? buildMeetingNotesDocument({
        v2: null,
        v3: normalizedV3,
        userNotes: meeting.user_notes || '',
        editsMap: parseUserEditsJson(meeting.user_edits_json),
        displayNames: speakerDisplayNames,
      })
    : null;
  const blocks = notesDocument?.sections.flatMap((section) => section.blocks);
  const settledBlocks = blocks?.filter((block) => block.blockType !== 'review');

  const notesText = notesDocument
    ? uniqueText(
        notesDocument.sections.flatMap((section) =>
          section.blocks.flatMap((block) => [
            ...(block.blockType === 'review' ? [] : [block.text]),
            ...(block.blockType === 'review'
              ? []
              : (block.nativeContinuations || []).map(
                  (continuation) => continuation.text,
                )),
          ]),
        ),
      )
    : uniqueText([clean(meeting.enhanced_notes), clean(meeting.user_notes)]);
  const decisionsText = uniqueText(
    settledBlocks
      ? settledBlocks
          .filter((block) => block.blockType === 'decision')
          .flatMap((block) => [
            block.text,
            ...(block.nativeContinuations || []).map(
              (continuation) => continuation.text,
            ),
          ])
      : (mid.decisions || []).map((decision) => clean(decision.description)),
  );
  const actionItemsText = uniqueText(
    settledBlocks
      ? settledBlocks
          .filter((block) => block.blockType === 'action')
          .flatMap((block) => [
            block.text,
            ...(block.nativeContinuations || []).map(
              (continuation) => continuation.text,
            ),
          ])
      : (mid.action_items || []).map((action) => clean(action.description)),
  );
  const topicsText = uniqueText(
    notesDocument
      ? notesDocument.sections
          .filter((section) => section.kind === 'discussion')
          .map((section) => section.title)
      : (mid.topics || []).map((topic) => clean(topic.name)),
  );
  const participantsText = uniqueText(
    (mid.participants || []).map((participant) => clean(participant.name)),
  );
  const entitiesText = uniqueText([
    ...(mid.participants || []).map((participant) => clean(participant.name)),
    ...(mid.topics || []).map((topic) => clean(topic.name)),
    ...(mid.projects || []).map((project) => clean(project.name)),
  ]);
  const sections: MeetingNotesEvidenceSection[] = notesDocument
    ? notesDocument.sections.flatMap((section) => {
        if (section.kind === 'review') return [];
        const acceptedBlocks = section.blocks.filter(
          (block) => block.blockType !== 'review' && block.text.trim(),
        );
        const content = uniqueText(
          acceptedBlocks.flatMap((block) => [
            block.text,
            ...(block.nativeContinuations || []).map(
              (continuation) => continuation.text,
            ),
          ]),
        );
        if (!content) return [];
        const transcriptRanges = acceptedBlocks
          .map((block) => block.transcriptRange)
          .filter((range): range is [number, number] => Boolean(range));
        const transcriptRange = transcriptRanges.length
          ? ([
              Math.min(...transcriptRanges.map((range) => range[0])),
              Math.max(...transcriptRanges.map((range) => range[1])),
            ] as [number, number])
          : section.transcriptRange;
        return [
          {
            sectionId: section.id,
            heading: section.title,
            kind: section.kind,
            summary: acceptedBlocks[0]?.text.slice(0, 600) || section.title,
            content,
            entitiesText,
            evidenceReferences: acceptedBlocks.slice(0, 24).map((block) => ({
              blockId: block.id,
              ...(block.path ? { path: block.path } : {}),
              ...(block.evidence ? { quote: block.evidence } : {}),
              ...(block.transcriptRange
                ? { transcriptRange: block.transcriptRange }
                : {}),
            })),
            ...(transcriptRange ? { transcriptRange } : {}),
          },
        ];
      })
    : [
        ...(notesText
          ? [
              {
                sectionId: 'meeting-notes',
                heading: 'Meeting notes',
                kind: 'discussion',
                summary: notesText.split('\n')[0]?.slice(0, 600) || notesText,
                content: notesText,
                entitiesText,
                evidenceReferences: [],
              },
            ]
          : []),
        ...(decisionsText
          ? [
              {
                sectionId: 'decisions',
                heading: 'Decisions',
                kind: 'outcomes',
                summary: decisionsText.split('\n')[0]?.slice(0, 600),
                content: decisionsText,
                entitiesText,
                evidenceReferences: [],
              },
            ]
          : []),
        ...(actionItemsText
          ? [
              {
                sectionId: 'action-items',
                heading: 'Action items',
                kind: 'outcomes',
                summary: actionItemsText.split('\n')[0]?.slice(0, 600),
                content: actionItemsText,
                entitiesText,
                evidenceReferences: [],
              },
            ]
          : []),
      ];
  const sourceRevision = createHash('sha256')
    .update(
      JSON.stringify({
        title: meeting.title || '',
        userNotes: meeting.user_notes || '',
        enhancedNotes: meeting.enhanced_notes || '',
        analysis: meeting.analysis_json || '',
        edits: meeting.user_edits_json || '',
        mid: meeting.mid_json || '',
      }),
    )
    .digest('hex');
  const trustStatus =
    meeting.analysis_format_pass === false || meeting.analysis_format_pass === 0
      ? 'needs_review'
      : 'grounded';
  const hasUsableNotes = Boolean(
    notesText ||
      decisionsText ||
      actionItemsText ||
      topicsText ||
      participantsText,
  );

  return {
    meetingId: String(meeting.id),
    title: clean(meeting.title) || 'Untitled meeting',
    notesText,
    decisionsText,
    actionItemsText,
    topicsText,
    participantsText,
    sourceRevision,
    trustStatus,
    sections,
    hasUsableNotes,
  };
};
