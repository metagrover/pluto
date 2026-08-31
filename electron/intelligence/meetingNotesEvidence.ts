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
}

export interface MeetingNotesEvidenceDocument {
  meetingId: string;
  title: string;
  notesText: string;
  decisionsText: string;
  actionItemsText: string;
  topicsText: string;
  participantsText: string;
  hasUsableNotes: boolean;
}

interface MidEvidence {
  participants?: Array<{ name?: unknown }>;
  topics?: Array<{ name?: unknown }>;
  decisions?: Array<{ description?: unknown }>;
  action_items?: Array<{ description?: unknown }>;
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
): MeetingNotesEvidenceDocument => {
  const v3 = parseAnalysisDocumentV3Json(meeting.analysis_json);
  const mid = parseMidEvidence(meeting.mid_json);
  const notesDocument = v3
    ? buildMeetingNotesDocument({
        v2: null,
        v3,
        userNotes: meeting.user_notes || '',
        editsMap: parseUserEditsJson(meeting.user_edits_json),
      })
    : null;
  const blocks = notesDocument?.sections.flatMap((section) => section.blocks);

  const notesText = notesDocument
    ? uniqueText(
        notesDocument.sections.flatMap((section) =>
          section.blocks.flatMap((block) => [
            block.text,
            ...(block.nativeContinuations || []).map(
              (continuation) => continuation.text,
            ),
          ]),
        ),
      )
    : uniqueText([clean(meeting.enhanced_notes), clean(meeting.user_notes)]);
  const decisionsText = uniqueText(
    blocks
      ? blocks
          .filter((block) => block.blockType === 'decision')
          .map((block) => block.text)
      : (mid.decisions || []).map((decision) => clean(decision.description)),
  );
  const actionItemsText = uniqueText(
    blocks
      ? blocks
          .filter((block) => block.blockType === 'action')
          .map((block) => block.text)
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
    hasUsableNotes,
  };
};
